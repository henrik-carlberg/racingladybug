import 'server-only';
import { sql } from '@/lib/db';
import { sequenceGaps, type Issue } from '@/lib/integrity';

/** Kontrollerar att bokföringen är hel: balans, obrutna nummerserier, datum inom räkenskapsår, inget nytt i låsta perioder */
export async function checkIntegrity(companyId: number): Promise<Issue[]> {
  const b = `/c/${companyId}`;
  const issues: Issue[] = [];
  const unbalanced = await sql<{ id: number; ver: string; d: number; c: number }[]>`
    SELECT v.id, v.series || v.number AS ver, COALESCE(SUM(l.debit), 0)::bigint AS d, COALESCE(SUM(l.credit), 0)::bigint AS c
    FROM vouchers v LEFT JOIN voucher_lines l ON l.voucher_id = v.id WHERE v.company_id = ${companyId}
    GROUP BY v.id HAVING COALESCE(SUM(l.debit), 0) <> COALESCE(SUM(l.credit), 0) OR count(l.id) = 0 LIMIT 20`;
  for (const u of unbalanced) issues.push({ key: `balance:${u.id}`, severity: 'error', title: `Verifikation ${u.ver} går inte jämnt ut`, detail: `Debet ${(Number(u.d) / 100).toFixed(2)} kr, kredit ${(Number(u.c) / 100).toFixed(2)} kr`, href: `${b}/verifikationer/${u.id}` });
  const series = await sql<{ fy: string; series: string; numbers: number[] }[]>`
    SELECT to_char(f.start_date,'YYYY-MM-DD') || ' – ' || to_char(f.end_date,'YYYY-MM-DD') AS fy, v.series, array_agg(v.number ORDER BY v.number) AS numbers
    FROM vouchers v JOIN fiscal_years f ON f.id = v.fiscal_year_id WHERE v.company_id = ${companyId} GROUP BY f.start_date, f.end_date, v.series`;
  for (const s of series) {
    const gaps = sequenceGaps(s.numbers);
    if (gaps.length) issues.push({ key: `gap:${s.fy}:${s.series}`, severity: 'error', title: `Luckor i verifikationsserie ${s.series} (${s.fy})`, detail: `Nummer som saknas: ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? ' …' : ''}`, href: `${b}/verifikationer` });
  }
  const outside = await sql<{ id: number; ver: string; date: string }[]>`
    SELECT v.id, v.series || v.number AS ver, to_char(v.date,'YYYY-MM-DD') AS date FROM vouchers v JOIN fiscal_years f ON f.id = v.fiscal_year_id
    WHERE v.company_id = ${companyId} AND (v.date < f.start_date OR v.date > f.end_date) LIMIT 20`;
  for (const o of outside) issues.push({ key: `outside:${o.id}`, severity: 'error', title: `Verifikation ${o.ver} ligger utanför sitt räkenskapsår`, detail: `Datum ${o.date}`, href: `${b}/verifikationer/${o.id}` });
  const badLines = await sql<{ id: number; ver: string }[]>`
    SELECT DISTINCT v.id, v.series || v.number AS ver FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${companyId} AND (l.debit < 0 OR l.credit < 0 OR (l.debit > 0 AND l.credit > 0)) LIMIT 20`;
  for (const x of badLines) issues.push({ key: `line:${x.id}`, severity: 'error', title: `Verifikation ${x.ver} har en ogiltig rad`, detail: 'Negativt belopp eller både debet och kredit på samma rad', href: `${b}/verifikationer/${x.id}` });
  // Verifikationer som skapats i en låst period efter att den låstes
  const [lock] = await sql<{ until: string | null; at: Date | null }[]>`
    SELECT to_char(c.locked_until,'YYYY-MM-DD') AS until, (SELECT max(created_at) FROM audit_log a WHERE a.company_id = c.id AND a.action = 'lock' AND a.entity = 'company') AS at
    FROM companies c WHERE c.id = ${companyId}`;
  if (lock?.until && lock.at) {
    const late = await sql<{ id: number; ver: string }[]>`
      SELECT id, series || number AS ver FROM vouchers WHERE company_id = ${companyId} AND date <= ${lock.until} AND created_at > ${lock.at} + interval '1 minute'
        AND source_type IS DISTINCT FROM 'carry_forward' LIMIT 20`;
    for (const l of late) issues.push({ key: `locked:${l.id}`, severity: 'error', title: `Verifikation ${l.ver} är bokförd i en låst period`, detail: `Perioden är låst till och med ${lock.until}`, href: `${b}/verifikationer/${l.id}` });
  }
  const [att] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM vouchers v WHERE v.company_id = ${companyId} AND v.date > current_date - 365 AND v.source_type IN ('manual','receipt','supplier_invoice')
      AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.voucher_id = v.id)
      AND NOT EXISTS (SELECT 1 FROM attachments a JOIN supplier_invoices si ON si.id = a.supplier_invoice_id WHERE si.voucher_id = v.id)`;
  if (att.n) issues.push({ key: 'attachments', severity: 'warn', title: `${att.n} verifikationer det senaste året saknar underlag`, detail: 'Bokföringslagen kräver underlag (kvitto, faktura) för varje affärshändelse', href: `${b}/verifikationer` });
  return issues;
}

export async function runIntegrity(companyId: number) {
  const issues = await checkIntegrity(companyId);
  const errors = issues.filter((i) => i.severity === 'error').length;
  await sql`INSERT INTO integrity_runs (company_id, errors, warnings, issues) VALUES (${companyId}, ${errors}, ${issues.length - errors}, ${sql.json(issues as never)})`;
  await sql`DELETE FROM integrity_runs WHERE company_id = ${companyId} AND run_at < now() - interval '90 days'`;
  return { errors, warnings: issues.length - errors, issues };
}

/** Daglig körning för alla bolag med bokföring */
export async function runAllIntegrity() {
  const cs = await sql<{ id: number }[]>`SELECT DISTINCT company_id AS id FROM vouchers`;
  let withErrors = 0;
  for (const c of cs) { try { if ((await runIntegrity(c.id)).errors) withErrors++; } catch (e) { console.error('integritet', c.id, e); } }
  return { companies: cs.length, withErrors };
}

export async function latestIntegrity(companyId: number) {
  const [r] = await sql<{ run_at: string; errors: number; warnings: number; issues: Issue[] }[]>`
    SELECT to_char(run_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS run_at, errors, warnings, issues FROM integrity_runs WHERE company_id = ${companyId} ORDER BY run_at DESC LIMIT 1`;
  return r ?? null;
}
