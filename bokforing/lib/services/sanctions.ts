import 'server-only';
import { sql, type Tx } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { buildIndex, match, namesFromCsv, normalize } from '@/lib/sanctions';
import type { Actor } from './actor';
import { str } from './input';

type Hit = { name: string; score: number };
type Party = { type: 'customer' | 'supplier'; id: number; name: string };

export async function overview(companyId: number) {
  const lists = await sql<{ id: number; source: string; filename: string; entries: number; uploaded_at: Date }[]>`SELECT id, source, filename, entries, uploaded_at FROM sanction_lists WHERE company_id = ${companyId} ORDER BY uploaded_at DESC`;
  const screenings = await sql<{ id: number; party_type: 'customer' | 'supplier'; party_id: number; party_name: string; screened_at: Date; hits: Hit[]; status: string; note: string; reviewed_at: Date | null }[]>`
    SELECT id, party_type, party_id, party_name, screened_at, hits, status, note, reviewed_at FROM sanction_screenings WHERE company_id = ${companyId} ORDER BY CASE status WHEN 'potential' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, party_name`;
  const [{ parties }] = await sql<{ parties: number }[]>`SELECT ((SELECT count(*) FROM customers WHERE company_id = ${companyId}) + (SELECT count(*) FROM suppliers WHERE company_id = ${companyId}))::int AS parties`;
  return { lists, screenings, parties, lastRun: screenings.reduce<Date | null>((m, s) => (!m || s.screened_at > m ? s.screened_at : m), null) };
}

/** En lista laddas upp och ersätter tidigare lista från samma källa; alla motparter kontrolleras därefter */
export async function upload(actor: Actor, source: string, file: File | null) {
  if (!['EU', 'UN', 'OTHER'].includes(source)) throw new ValidationError('Välj källa');
  if (!file || !file.size) throw new ValidationError('Välj en CSV-fil');
  if (file.size > 9.5 * 1024 * 1024) throw new ValidationError('Filen är för stor (högst 9,5 MB) – dela upp listan');
  const names = namesFromCsv(await file.text());
  if (!names.length) throw new ValidationError('Hittade inga namn i filen');
  await sql.begin(async (tx) => {
    await tx`DELETE FROM sanction_lists WHERE company_id = ${actor.companyId} AND source = ${source}`;
    const [l] = await tx<{ id: number }[]>`INSERT INTO sanction_lists ${tx({ company_id: actor.companyId, source, filename: file.name.slice(0, 200), entries: names.length, uploaded_by: actor.userId })} RETURNING id`;
    for (let i = 0; i < names.length; i += 1000) {
      const chunk = names.slice(i, i + 1000).map((n) => ({ list_id: l.id, company_id: actor.companyId, name: n.slice(0, 300), normalized: normalize(n).slice(0, 300) })).filter((x) => x.normalized);
      if (chunk.length) await tx`INSERT INTO sanction_entries ${tx(chunk)}`;
    }
  });
  await auditBy(sql, actor, 'sanction_list', 'company', actor.companyId, { source, entries: names.length });
  const r = await screenAll(actor);
  return { entries: names.length, ...r };
}

async function screen(db: Tx | typeof sql, companyId: number, parties: Party[]) {
  const entries = await db<{ id: number; name: string; normalized: string }[]>`SELECT id, name, normalized FROM sanction_entries WHERE company_id = ${companyId}`;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const idx = buildIndex(entries);
  let potential = 0;
  for (const p of parties) {
    const n = normalize(p.name);
    const cand = new Set<number>();
    for (const t of new Set(n.split(' '))) for (const id of idx.get(t.slice(0, 3)) ?? []) cand.add(id);
    const hits: Hit[] = [];
    for (const id of cand) { const e = byId.get(id)!; const s = match(n, e.normalized); if (s) hits.push({ name: e.name, score: s }); }
    hits.sort((a, b) => b.score - a.score);
    const top = hits.slice(0, 5);
    // En tidigare bedömning står sig om träffarna är desamma; nya träffar granskas på nytt
    const [prev] = await db<{ status: string; hits: Hit[] }[]>`SELECT status, hits FROM sanction_screenings WHERE company_id = ${companyId} AND party_type = ${p.type} AND party_id = ${p.id}`;
    const same = prev && JSON.stringify(prev.hits.map((h) => h.name).sort()) === JSON.stringify(top.map((h) => h.name).sort());
    const status = !top.length ? 'clear' : same && (prev.status === 'false_positive' || prev.status === 'confirmed') ? prev.status : 'potential';
    if (status === 'potential') potential++;
    await db`INSERT INTO sanction_screenings (company_id, party_type, party_id, party_name, hits, status) VALUES (${companyId}, ${p.type}, ${p.id}, ${p.name}, ${db.json(top)}, ${status})
      ON CONFLICT (company_id, party_type, party_id) DO UPDATE SET party_name = EXCLUDED.party_name, hits = EXCLUDED.hits, status = EXCLUDED.status, screened_at = now(),
        note = CASE WHEN EXCLUDED.status = sanction_screenings.status THEN sanction_screenings.note ELSE '' END`;
  }
  return potential;
}

export async function screenAll(actor: Actor) {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sanction_entries WHERE company_id = ${actor.companyId}`;
  if (!n) throw new ValidationError('Ladda upp en sanktionslista först');
  const parties = [
    ...(await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${actor.companyId}`).map((c) => ({ type: 'customer' as const, ...c })),
    ...(await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${actor.companyId}`).map((s) => ({ type: 'supplier' as const, ...s })),
  ];
  const potential = await sql.begin((tx) => screen(tx, actor.companyId, parties));
  await auditBy(sql, actor, 'sanction_screening', 'company', actor.companyId, { parties: parties.length, potential });
  return { parties: parties.length, potential };
}

/** Granskning av en möjlig träff: falsk träff eller sann träff (stoppar fakturering och betalning) */
export async function review(actor: Actor, id: number, input: Record<string, unknown>) {
  const decision = input.decision === 'confirmed' ? 'confirmed' : input.decision === 'false_positive' ? 'false_positive' : null;
  if (!decision) throw new ValidationError('Välj bedömning');
  const note = str(input, 'note', { required: true, label: 'Motivering', max: 1000 });
  const [s] = await sql<{ status: string }[]>`SELECT status FROM sanction_screenings WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!s) throw new NotFoundError('Kontrollen');
  if (s.status === 'clear') throw new ConflictError('Det finns ingen träff att granska');
  await sql`UPDATE sanction_screenings SET status = ${decision}, note = ${note}, reviewed_by = ${actor.userId}, reviewed_at = now() WHERE id = ${id}`;
  await auditBy(sql, actor, `sanction_${decision}`, 'sanction_screening', id, {});
  return decision;
}

/** Stopp: fakturering och betalning till en motpart med bekräftad träff */
export async function sanctionGuard(db: Tx | typeof sql, companyId: number, type: 'customer' | 'supplier', partyId: number) {
  const [s] = await db<{ party_name: string }[]>`SELECT party_name FROM sanction_screenings WHERE company_id = ${companyId} AND party_type = ${type} AND party_id = ${partyId} AND status = 'confirmed'`;
  if (s) throw new ValidationError(`${s.party_name} finns på en sanktionslista – ${type === 'customer' ? 'fakturering' : 'betalning'} är stoppad`);
}
