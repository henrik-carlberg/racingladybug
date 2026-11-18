import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { decodeSie, parseSie, sieProblems, type SieFile } from '@/lib/sie';
import type { Actor } from './actor';

export interface SiePreview {
  id: number; filename: string; status: 'preview' | 'imported'; file: SieFile; problems: string[];
  year: { start: string; end: string } | null; fiscalYearId: number | null; yearClosed: boolean; overlap: boolean;
  newAccounts: { number: number; name: string }[]; hasOpeningBalance: boolean; existingVouchers: number;
  ibAccounts: number; series: Record<string, number>; result: { accounts: number; opening: boolean; vouchers: number } | null;
}

/** Läser in filen, sparar den för förhandsgranskning och returnerar id */
export async function uploadSie(actor: Actor, filename: string, bytes: Uint8Array): Promise<number> {
  if (!bytes.length) throw new ValidationError('Välj en SIE-fil');
  if (bytes.length > 9 * 1024 * 1024) throw new ValidationError('Filen är för stor (högst 9 MB)');
  const text = decodeSie(bytes);
  if (!/^\s*#FLAGGA/m.test(text) && !/#VER|#KONTO|#IB/.test(text)) throw new ValidationError('Filen ser inte ut som en SIE-fil');
  const file = parseSie(text);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await sql`DELETE FROM sie_imports WHERE company_id = ${actor.companyId} AND status = 'preview' AND created_at < now() - interval '1 day'`;
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO sie_imports (company_id, created_by, filename, file_hash, data) VALUES (${actor.companyId}, ${actor.userId}, ${filename.slice(0, 200)}, ${hash}, ${sql.json(file as never)}) RETURNING id`;
  return r.id;
}

export async function siePreview(companyId: number, id: number): Promise<SiePreview> {
  const [r] = await sql<{ id: number; filename: string; status: 'preview' | 'imported'; data: SieFile; result: SiePreview['result'] }[]>`
    SELECT id, filename, status, data, result FROM sie_imports WHERE id = ${id} AND company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Importen');
  const file = r.data;
  const year = file.years[0] ?? null;
  let fy: { id: number; closed: boolean } | undefined; let overlap = false;
  if (year) {
    [fy] = await sql<{ id: number; closed: boolean }[]>`SELECT id, closed FROM fiscal_years WHERE company_id = ${companyId} AND start_date = ${year.start} AND end_date = ${year.end}`;
    if (!fy) overlap = (await sql`SELECT 1 FROM fiscal_years WHERE company_id = ${companyId} AND start_date <= ${year.end} AND end_date >= ${year.start}`).length > 0;
  }
  const existing = new Set((await sql<{ number: number }[]>`SELECT number FROM accounts WHERE company_id = ${companyId}`).map((a) => a.number));
  const named = new Map(file.accounts.map((a) => [a.number, a.name]));
  const used = new Set<number>([...file.accounts.map((a) => a.number), ...file.vouchers.flatMap((v) => v.lines.map((l) => l.account)),
    ...Object.keys(file.openingBalances[0] ?? {}).map(Number).filter((n) => n < 3000)]);
  const newAccounts = [...used].filter((n) => n >= 1000 && n <= 9999 && !existing.has(n)).sort((a, b) => a - b).map((n) => ({ number: n, name: named.get(n) || `Konto ${n}` }));
  const [st] = fy ? await sql<{ ib: boolean; n: number }[]>`
    SELECT EXISTS (SELECT 1 FROM vouchers v WHERE v.fiscal_year_id = ${fy.id} AND v.source_type = 'opening_balance' AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)) AS ib,
      (SELECT count(*)::int FROM vouchers WHERE fiscal_year_id = ${fy.id} AND source_type IS DISTINCT FROM 'opening_balance') AS n` : [{ ib: false, n: 0 }];
  const series: Record<string, number> = {};
  for (const v of file.vouchers) series[v.series] = (series[v.series] ?? 0) + 1;
  const problems = sieProblems(file);
  if (overlap) problems.push(`Räkenskapsåret ${year!.start} – ${year!.end} överlappar ett befintligt räkenskapsår med andra datum`);
  if (fy?.closed) problems.push('Räkenskapsåret är stängt');
  return {
    id: r.id, filename: r.filename, status: r.status, file, problems, year, fiscalYearId: fy?.id ?? null, yearClosed: !!fy?.closed, overlap, newAccounts,
    hasOpeningBalance: st.ib, existingVouchers: st.n, ibAccounts: Object.entries(file.openingBalances[0] ?? {}).filter(([a, v]) => Number(a) < 3000 && v !== 0).length,
    series, result: r.result,
  };
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Importerar kontoplan, ingående balanser och/eller verifikationer i en transaktion */
export async function importSie(actor: Actor, id: number, opts: { accounts: boolean; opening: boolean; vouchers: boolean }) {
  const p = await siePreview(actor.companyId, id);
  if (p.status === 'imported') throw new ConflictError('Filen är redan importerad');
  if (!opts.accounts && !opts.opening && !opts.vouchers) throw new ValidationError('Välj vad som ska importeras');
  if ((opts.opening || opts.vouchers) && p.problems.length) throw new ValidationError(`Filen kan inte importeras: ${p.problems.slice(0, 3).join('; ')}`);
  if (opts.opening && p.hasOpeningBalance) throw new ConflictError('Räkenskapsåret har redan ingående balanser');
  if (opts.opening && !p.ibAccounts) throw new ValidationError('Filen innehåller inga ingående balanser');
  if (opts.vouchers && p.existingVouchers > 0) throw new ConflictError(`Räkenskapsåret har redan ${p.existingVouchers} verifikationer. Verifikationer kan bara importeras till ett tomt räkenskapsår.`);
  const f = p.file;
  const result = await sql.begin(async (tx) => {
    if ((await tx`SELECT 1 FROM sie_imports WHERE company_id = ${actor.companyId} AND file_hash = (SELECT file_hash FROM sie_imports WHERE id = ${id}) AND status = 'imported'`).length) {
      throw new ConflictError('Samma fil är redan importerad');
    }
    // Kontoplan: nya konton läggs till (befintliga namn behålls). Konton som används krävs alltid.
    const needed = opts.accounts ? p.newAccounts : p.newAccounts.filter((a) => (opts.vouchers && f.vouchers.some((v) => v.lines.some((l) => l.account === a.number)))
      || (opts.opening && (f.openingBalances[0]?.[a.number] ?? 0) !== 0));
    if (needed.length) {
      await tx`INSERT INTO accounts ${tx(needed.map((a) => ({ company_id: actor.companyId, number: a.number, name: a.name.slice(0, 100) })))} ON CONFLICT DO NOTHING`;
    }
    let fyId = p.fiscalYearId;
    let opening = false; let vouchers = 0;
    if (opts.opening || opts.vouchers) {
      const [co] = await tx<{ locked: string | null }[]>`SELECT to_char(locked_until,'YYYY-MM-DD') AS locked FROM companies WHERE id = ${actor.companyId} FOR UPDATE`;
      if (co.locked && p.year!.start <= co.locked) throw new ConflictError(`Perioden är låst till och med ${co.locked}`);
      if (!fyId) {
        [{ id: fyId }] = await tx<{ id: number }[]>`INSERT INTO fiscal_years (company_id, start_date, end_date) VALUES (${actor.companyId}, ${p.year!.start}, ${p.year!.end}) RETURNING id`;
      }
      // Kostnadsställen (dimension 1) följer med: de skapas om de saknas
      const ccNames = f.objects?.['1'] ?? {};
      const ccCodes = new Set<string>([...Object.keys(ccNames), ...f.vouchers.flatMap((v) => v.lines.map((l) => l.objects?.['1']).filter((x): x is string => !!x))]);
      const ccMap = new Map<string, number>();
      for (const code of ccCodes) {
        const c = code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
        if (!c) continue;
        await tx`INSERT INTO cost_centers (company_id, code, name) VALUES (${actor.companyId}, ${c}, ${(ccNames[code] || c).slice(0, 100)}) ON CONFLICT DO NOTHING`;
        const [r] = await tx<{ id: number }[]>`SELECT id FROM cost_centers WHERE company_id = ${actor.companyId} AND code = ${c}`;
        ccMap.set(code, r.id);
      }
      type Row = { series: string; date: string; description: string; source_type: string; lines: { account: number; amount: number; description: string; objects?: Record<string, string> }[] };
      const rows: Row[] = [];
      if (opts.opening) {
        const lines = Object.entries(f.openingBalances[0]).map(([a, v]) => ({ account: Number(a), amount: v, description: '' })).filter((l) => l.account < 3000 && l.amount !== 0);
        rows.push({ series: 'I', date: p.year!.start, description: 'Ingående balanser (SIE-import)', source_type: 'opening_balance', lines });
        opening = true;
      }
      if (opts.vouchers) {
        for (const v of f.vouchers) {
          const lines = v.lines.filter((l) => l.amount !== 0);
          if (!lines.length) continue;
          const series = (v.series || 'A').replace(/[^A-Za-z0-9ÅÄÖåäö]/g, '').slice(0, 5) || 'A';
          rows.push({ series, date: v.date, description: `${v.description || 'Verifikation'} (SIE ${v.series}${v.number})`.slice(0, 500), source_type: 'sie_import', lines });
        }
      }
      const next = new Map<string, number>();
      for (const r of await tx<{ series: string; n: number }[]>`SELECT series, max(number)::int AS n FROM vouchers WHERE fiscal_year_id = ${fyId} GROUP BY series`) next.set(r.series, r.n);
      const sorted = [...rows].sort((a, b) => (a.source_type === 'opening_balance' ? -1 : 0) || a.date.localeCompare(b.date));
      const numbered = sorted.map((r) => { const n = (next.get(r.series) ?? 0) + 1; next.set(r.series, n); return { ...r, number: n }; });
      for (const part of chunk(numbered, 2000)) {
        const ids = await tx<{ id: number; series: string; number: number }[]>`INSERT INTO vouchers ${tx(part.map((r) => ({
          company_id: actor.companyId, fiscal_year_id: fyId, series: r.series, number: r.number, date: r.date, description: r.description,
          source_type: r.source_type, source_id: id, created_by: actor.userId,
        })))} RETURNING id, series, number`;
        const byKey = new Map(ids.map((x) => [`${x.series}|${x.number}`, x.id]));
        const lines = part.flatMap((r) => r.lines.map((l) => ({
          voucher_id: byKey.get(`${r.series}|${r.number}`)!, account_number: l.account,
          debit: l.amount > 0 ? l.amount : 0, credit: l.amount < 0 ? -l.amount : 0, description: (l.description || '').slice(0, 200),
          cost_center_id: (l.objects?.['1'] && ccMap.get(l.objects['1'])) || null,
        })));
        for (const lp of chunk(lines, 8000)) await tx`INSERT INTO voucher_lines ${tx(lp)}`;
      }
      vouchers = numbered.length - (opening ? 1 : 0);
    }
    const res = { accounts: needed.length, opening, vouchers };
    await tx`UPDATE sie_imports SET status = 'imported', result = ${tx.json(res)} WHERE id = ${id}`;
    await auditBy(tx, actor, 'sie_import', 'fiscal_year', fyId ?? 0, { file: p.filename, ...res });
    return res;
  });
  return result;
}
