import 'server-only';
import { sql } from '@/lib/db';
import { PERMISSIONS } from '@/lib/permissions';

const SOURCE: Record<string, string> = {
  manual: 'manuella verifikationer', receipt: 'kvitton och utlägg', invoice: 'kundfakturor', invoice_payment: 'inbetalningar från kunder', supplier_invoice: 'leverantörsfakturor',
  supplier_payment: 'betalningar till leverantörer', payroll: 'löner', vat: 'momsavräkningar', reversal: 'rättelser', opening_balance: 'ingående balanser', carry_forward: 'resultatdisposition',
  dividend_decision: 'beslut om utdelning', dividend_payment: 'utbetald utdelning', depreciation: 'avskrivningar', accrual: 'periodiseringar', yearend: 'bokslut',
};

/** Underlag för systemdokumentation och behandlingshistorik (BFL 5 kap. 11 §, BFNAR 2013:2 kap. 9) */
export async function systemDocumentation(companyId: number) {
  const [c] = await sql<{ name: string; orgnr: string; company_type: string; address: string; postal_code: string; city: string; accounting_method: string; vat_period: string; locked_until: string | null; attest_threshold: number | null; attest_not_registrant: boolean; created_at: string }[]>`
    SELECT name, orgnr, company_type, address, postal_code, city, accounting_method, vat_period, to_char(locked_until,'YYYY-MM-DD') AS locked_until, attest_threshold, attest_not_registrant, to_char(created_at,'YYYY-MM-DD') AS created_at FROM companies WHERE id = ${companyId}`;
  const [years, series, accounts, users, firms, audit, changes, integrations] = await Promise.all([
    sql<{ id: number; start: string; end: string; closed: boolean; vouchers: number }[]>`SELECT f.id, to_char(f.start_date,'YYYY-MM-DD') AS start, to_char(f.end_date,'YYYY-MM-DD') AS "end", f.closed, (SELECT count(*)::int FROM vouchers v WHERE v.fiscal_year_id = f.id) AS vouchers FROM fiscal_years f WHERE f.company_id = ${companyId} ORDER BY f.start_date DESC`,
    sql<{ series: string; sources: string[]; n: number; first: string; last: string }[]>`SELECT series, array_agg(DISTINCT COALESCE(source_type, 'manual')) AS sources, count(*)::int AS n, to_char(min(date),'YYYY-MM-DD') AS first, to_char(max(date),'YYYY-MM-DD') AS last FROM vouchers WHERE company_id = ${companyId} GROUP BY series ORDER BY series`,
    sql<{ number: number; name: string; active: boolean }[]>`SELECT number, name, active FROM accounts WHERE company_id = ${companyId} ORDER BY number`,
    sql<{ name: string; email: string; role: string; permissions: string[] | null; since: string }[]>`SELECT u.name, u.email, m.role, m.permissions, to_char(m.created_at,'YYYY-MM-DD') AS since FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${companyId} ORDER BY m.role, u.name`,
    sql<{ name: string; since: string }[]>`SELECT f.name, to_char(fc.created_at,'YYYY-MM-DD') AS since FROM firm_clients fc JOIN firms f ON f.id = fc.firm_id WHERE fc.company_id = ${companyId}`,
    sql<{ action: string; entity: string; n: number }[]>`SELECT action, entity, count(*)::int AS n FROM audit_log WHERE company_id = ${companyId} AND created_at > now() - interval '12 months' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25`,
    sql<{ at: string; who: string | null; action: string; entity: string; details: unknown }[]>`
      SELECT to_char(a.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS at, u.name AS who, a.action, a.entity, a.details FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.company_id = ${companyId} AND a.entity IN ('company','account','membership','fiscal_year','bank_rule','firm','api_key','webhook','email_template','report_schedule') ORDER BY a.created_at DESC LIMIT 60`,
    sql<{ bank: number; inbox: boolean; autogiro: boolean; api_keys: number; webhooks: number; stripe: boolean; rules: number }[]>`SELECT
      (SELECT count(*)::int FROM bank_connections WHERE company_id = ${companyId} AND status = 'active') AS bank, inbox_token IS NOT NULL AS inbox, autogiro_customer_no <> '' AS autogiro,
      (SELECT count(*)::int FROM api_keys WHERE company_id = ${companyId} AND revoked_at IS NULL) AS api_keys, (SELECT count(*)::int FROM webhook_endpoints WHERE company_id = ${companyId} AND active) AS webhooks,
      stripe_account_id IS NOT NULL AS stripe, (SELECT count(*)::int FROM bank_rules WHERE company_id = ${companyId}) AS rules FROM companies WHERE id = ${companyId}`,
  ]);
  return {
    company: c, years: [...years], accounts: [...accounts], users: [...users], firms: [...firms], audit: [...audit], changes: [...changes], integrations: integrations[0],
    series: series.map((s) => ({ ...s, description: s.sources.map((x) => SOURCE[x] ?? x).join(', ') })),
    permissionNames: PERMISSIONS as Record<string, string>,
    version: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'lokal',
    generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
  };
}
export type SysDoc = Awaited<ReturnType<typeof systemDocumentation>>;
