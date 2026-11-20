import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, createVoucher } from '@/lib/server/ledger';
import { buildEskd } from '@/lib/eskd';
import { vatReport, type AccountSums } from '@/lib/vat';
import { boxDiff, correctionLines, dueDate, fromMap, toMap } from '@/lib/vat-correction';
import { today } from '@/lib/format';
import type { Actor } from './actor';
import { date } from './input';

const num = (m: Map<number, number | bigint>): AccountSums => new Map([...m].map(([k, v]) => [k, Number(v)]));

/** Det som senast deklarerades för perioden: ögonblicksbilden, eller för äldre avräkningar saldona när avräkningen gjordes */
async function declared(companyId: number, from: string, to: string) {
  // Avräkningen för exakt den här perioden måste finnas och inte vara makulerad – annars är perioden inte deklarerad
  const [v] = await sql<{ created_at: Date }[]>`SELECT created_at FROM vouchers v WHERE company_id = ${companyId} AND source_type = 'vat' AND date = ${to}
    AND description LIKE ${`Momsavräkning ${from} – ${to}%`} AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id) ORDER BY id DESC LIMIT 1`;
  if (!v) return null;
  const [d] = await sql<{ sums: Record<string, number>; kind: string; n: number }[]>`SELECT sums, kind, (SELECT count(*)::int FROM vat_declarations x WHERE x.company_id = ${companyId} AND x.period_from = ${from} AND x.period_to = ${to} AND x.kind = 'correction') AS n
    FROM vat_declarations WHERE company_id = ${companyId} AND period_from = ${from} AND period_to = ${to} ORDER BY id DESC LIMIT 1`;
  if (d) return { sums: toMap(d.sums), corrections: d.n };
  const rows = await sql<{ account: number; b: number }[]>`SELECT l.account_number AS account, SUM(l.debit - l.credit)::float8 AS b FROM voucher_lines l JOIN vouchers x ON x.id = l.voucher_id
    WHERE x.company_id = ${companyId} AND x.date BETWEEN ${from} AND ${to} AND x.created_at <= ${v.created_at} AND COALESCE(x.source_type, '') NOT IN ('vat', 'vat_correction', 'opening_balance')
      AND NOT (x.source_type = 'reversal' AND EXISTS (SELECT 1 FROM vouchers o WHERE o.id = x.corrects_id AND o.source_type IN ('vat', 'vat_correction'))) GROUP BY l.account_number`;
  return { sums: new Map(rows.map((r) => [r.account, r.b])), corrections: 0 };
}

/** Status för perioden: deklarerad eller inte, och vad som ändrats sedan dess */
export async function correctionStatus(companyId: number, from: string, to: string) {
  const d = await declared(companyId, from, to);
  if (!d) return null;
  const current = num(await accountSums(companyId, from, to, { excludeVatSettlements: true }));
  const diff = boxDiff(current, d.sums);
  const history = await sql<{ kind: string; to_pay: number; to_pay_diff: number; created: string; voucher_id: number | null; filing_id: number | null }[]>`
    SELECT kind, to_pay::float8 AS to_pay, to_pay_diff::float8 AS to_pay_diff, to_char(created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD') AS created, voucher_id, filing_id
    FROM vat_declarations WHERE company_id = ${companyId} AND period_from = ${from} AND period_to = ${to} ORDER BY id`;
  const due = dueDate(to);
  const late = Math.max(0, Math.round((Date.parse(today()) - Date.parse(due)) / 864e5));
  return { ...diff, needed: diff.rows.length > 0 || correctionLines(current, d.sums).length > 0, corrections: d.corrections, history, due, daysLate: late };
}

/** Bokför rättelsen (det som tillkommit förs till 2650) och förbereder en ny deklaration för perioden */
export async function correct(actor: Actor, from: string, to: string, input: Record<string, unknown>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new ValidationError('Ogiltig period');
  const d0 = date(input, 'date', 'Bokföringsdatum', false) || today();
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(110001, ${actor.companyId})`;
    const d = await declared(actor.companyId, from, to);
    if (!d) throw new NotFoundError('En deklarerad momsperiod');
    const current = num(await accountSums(actor.companyId, from, to, { excludeVatSettlements: true }));
    const lines = correctionLines(current, d.sums);
    const diff = boxDiff(current, d.sums);
    if (!lines.length && !diff.rows.length) throw new ConflictError('Ingenting har ändrats sedan perioden deklarerades');
    const n = d.corrections + 1;
    const v = lines.length ? await createVoucher(tx, { actor, date: d0, description: `Rättelse ${n} av momsdeklaration ${from} – ${to} (${diff.toPayDiff >= 0 ? 'mer' : 'mindre'} att betala)`, lines, sourceType: 'vat_correction' }) : null;
    const [c] = await tx<{ orgnr: string }[]>`SELECT orgnr FROM companies WHERE id = ${actor.companyId}`;
    const payload = buildEskd({ orgnr: c.orgnr, periodEnd: to, boxes: vatReport(current).boxes });
    const { createHash } = await import('node:crypto');
    const [f] = await tx<{ id: number }[]>`INSERT INTO filings (company_id, kind, period, deadline_key, filename, payload, sha256, created_by)
      VALUES (${actor.companyId}, 'moms', ${`${from}:${to}:r${n}`}, ${`vat-correction:${from}:${to}:${n}`}, ${`moms_${to.slice(0, 7)}_rattelse${n}.eskd`}, ${payload}, ${createHash('sha256').update(payload).digest('hex')}, ${actor.userId}) RETURNING id`;
    await tx`INSERT INTO vat_declarations ${tx({ company_id: actor.companyId, period_from: from, period_to: to, kind: 'correction', sums: tx.json(fromMap(current) as never) as never,
      to_pay: diff.currentToPay, to_pay_diff: diff.toPayDiff, voucher_id: v?.id ?? null, filing_id: f.id, created_by: actor.userId })}`;
    await auditBy(tx, actor, 'vat_correction', 'vat', v?.id ?? null, { from, to, diff: diff.toPayDiff });
    return { ...diff, n, filingId: f.id };
  });
}

/** Deklarerade perioder (för varningen när något bokförs i en redan deklarerad period) */
export async function declaredPeriods(companyId: number) {
  const rows = await sql<{ from: string; to: string }[]>`SELECT DISTINCT to_char(period_from,'YYYY-MM-DD') AS from, to_char(period_to,'YYYY-MM-DD') AS to FROM vat_declarations WHERE company_id = ${companyId}`;
  const old = await sql<{ d: string; desc: string }[]>`SELECT to_char(date,'YYYY-MM-DD') AS d, description AS desc FROM vouchers v WHERE company_id = ${companyId} AND source_type = 'vat'
    AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id)`;
  for (const o of old) { const m = /(\d{4}-\d{2}-\d{2}) – (\d{4}-\d{2}-\d{2})/.exec(o.desc); if (m && !rows.some((r) => r.from === m[1] && r.to === m[2])) rows.push({ from: m[1], to: m[2] }); }
  return rows;
}
