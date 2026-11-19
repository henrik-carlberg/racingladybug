import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, openingBalances } from '@/lib/server/ledger';
import { addDays, today } from '@/lib/format';
import { evaluate, kpis, ROLE_KPIS, validateDef, type ColumnData, type ReportDef, type RowDef } from '@/lib/report-builder';
import type { Actor } from './actor';
import { canView } from '@/lib/permissions';

export const TEMPLATES: Record<string, { name: string; def: ReportDef }> = {
  kort: { name: 'Resultat i korthet', def: { columns: 'year', compare: true, budget: true, rows: [
    { key: 'r1', label: 'Nettoomsättning', type: 'accounts', value: '3000-3799' },
    { key: 'r2', label: 'Varor och material', type: 'accounts', value: '4000-4999' },
    { key: 'r3', label: 'Bruttovinst', type: 'formula', value: 'r1 - r2', bold: true },
    { key: 'r4', label: 'Övriga externa kostnader', type: 'accounts', value: '5000-6999' },
    { key: 'r5', label: 'Personal', type: 'accounts', value: '7000-7699' },
    { key: 'r6', label: 'Avskrivningar', type: 'accounts', value: '7700-7899' },
    { key: 'r7', label: 'Rörelseresultat', type: 'formula', value: 'r3 - r4 - r5 - r6', bold: true },
    { key: 'r8', label: 'Rörelsemarginal %', type: 'formula', value: 'r7 / r1 * 100' },
  ] } },
  manad: { name: 'Intäkter och kostnader per månad', def: { columns: 'months', compare: false, budget: false, rows: [
    { key: 'r1', label: 'Intäkter', type: 'accounts', value: '3000-3999' },
    { key: 'r2', label: 'Kostnader', type: 'accounts', value: '4000-7999' },
    { key: 'r3', label: 'Resultat', type: 'formula', value: 'r1 - r2', bold: true },
    { key: 'r4', label: 'Kassa och bank', type: 'accounts', value: '1900-1999' },
  ] } },
};

export async function listReports(companyId: number) {
  return [...await sql<{ id: number; name: string; updated: string }[]>`SELECT id, name, to_char(updated_at,'YYYY-MM-DD') AS updated FROM custom_reports WHERE company_id = ${companyId} ORDER BY name`];
}
export async function getReport(companyId: number, id: number) {
  const [r] = await sql<{ id: number; name: string; definition: ReportDef }[]>`SELECT id, name, definition FROM custom_reports WHERE id = ${id} AND company_id = ${companyId}`;
  if (!r) throw new NotFoundError('Rapporten');
  return r;
}

/** Formulärets rader (label_0, type_0, value_0, bold_0 …) → definition */
export function defFromForm(input: Record<string, string>): ReportDef {
  const rows: RowDef[] = [];
  for (let i = 0; i < 40; i++) {
    const label = (input[`label_${i}`] ?? '').trim(), value = (input[`value_${i}`] ?? '').trim();
    const type = (['accounts', 'formula', 'heading'].includes(input[`type_${i}`]) ? input[`type_${i}`] : 'accounts') as RowDef['type'];
    if (!label && !value) continue;
    rows.push({ key: `r${i + 1}`, label: label.slice(0, 80), type, value: type === 'heading' ? '' : value.slice(0, 300), bold: input[`bold_${i}`] === 'on' });
  }
  const columns = (['months', 'quarters', 'year'].includes(input.columns) ? input.columns : 'year') as ReportDef['columns'];
  return { rows, columns, compare: input.compare === 'on', budget: input.budget === 'on' && columns === 'year' };
}

export async function saveReport(actor: Actor, id: number | null, name: string, def: ReportDef) {
  if (!name.trim()) throw new ValidationError('Ge rapporten ett namn');
  const errs = validateDef(def);
  if (errs.length) throw new ValidationError(errs.join('. '));
  if (id) {
    const r = await sql`UPDATE custom_reports SET name = ${name.trim().slice(0, 100)}, definition = ${sql.json(def as never)}, updated_at = now() WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
    if (!r.length) throw new NotFoundError('Rapporten');
    await auditBy(sql, actor, 'update', 'custom_report', id);
    return id;
  }
  const [r] = await sql<{ id: number }[]>`INSERT INTO custom_reports (company_id, name, definition, created_by) VALUES (${actor.companyId}, ${name.trim().slice(0, 100)}, ${sql.json(def as never)}, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'create', 'custom_report', r.id);
  return r.id;
}
export async function deleteReport(actor: Actor, id: number) {
  const r = await sql`DELETE FROM custom_reports WHERE id = ${id} AND company_id = ${actor.companyId} RETURNING id`;
  if (!r.length) throw new NotFoundError('Rapporten');
  await auditBy(sql, actor, 'delete', 'custom_report', id);
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
async function budgetMap(companyId: number, year: number, months: number[]) {
  const rows = await sql<{ account: number; amount: number }[]>`SELECT account, SUM(amount)::bigint AS amount FROM account_budgets WHERE company_id = ${companyId} AND year = ${year} AND month IN ${sql(months)} GROUP BY 1`;
  return rows.length ? new Map(rows.map((r) => [r.account, Number(r.amount)])) : null;
}
async function column(companyId: number, label: string, from: string, to: string, budgetYear?: number, budgetMonths?: number[]): Promise<ColumnData> {
  return { label, result: await accountSums(companyId, from, to), balance: await openingBalances(companyId, addDays(to, 1)), budget: budgetYear ? await budgetMap(companyId, budgetYear, budgetMonths!) : null };
}

/** Kolumner: helår hittills (med jämförelse och budget), kvartal eller månader */
export async function runReport(companyId: number, def: ReportDef, year: number) {
  const t = today(), cy = Number(t.slice(0, 4));
  const lastMonth = year < cy ? 12 : year > cy ? 0 : Number(t.slice(5, 7));
  const cols: ColumnData[] = [];
  if (def.columns === 'year') {
    const to = year < cy ? `${year}-12-31` : t;
    const months = Array.from({ length: Math.max(lastMonth, 1) }, (_, i) => i + 1);
    cols.push(await column(companyId, year < cy ? String(year) : `${year} t.o.m. ${t.slice(5)}`, `${year}-01-01`, to, def.budget ? year : undefined, months));
    if (def.compare) cols.push(await column(companyId, `${year - 1} samma period`, `${year - 1}-01-01`, `${year - 1}${to.slice(4)}`));
  } else {
    const n = def.columns === 'months' ? 12 : 4, step = def.columns === 'months' ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const m0 = i * step + 1, m1 = m0 + step - 1;
      const label = def.columns === 'months' ? `${year}-${pad(m0)}` : `Q${i + 1} ${year}`;
      if (m0 > Math.max(lastMonth, 0) && year >= cy) { cols.push({ label, result: new Map(), balance: new Map(), budget: null }); continue; }
      cols.push(await column(companyId, label, `${year}-${pad(m0)}-01`, monthEnd(year, m1)));
      if (def.compare) cols.push(await column(companyId, `${def.columns === 'months' ? `${year - 1}-${pad(m0)}` : `Q${i + 1} ${year - 1}`}`, `${year - 1}-${pad(m0)}-01`, monthEnd(year - 1, m1)));
    }
  }
  return { columns: cols.map((c) => c.label), rows: evaluate(def, cols), hasBudget: cols.some((c) => c.budget) };
}

/** Nyckeltal hittills i år och samma period i fjol */
export async function kpiView(companyId: number) {
  const t = today(), y = Number(t.slice(0, 4));
  const days = Math.round((Date.parse(t) - Date.parse(`${y}-01-01`)) / 864e5) + 1;
  const now = kpis(await accountSums(companyId, `${y}-01-01`, t), await openingBalances(companyId, addDays(t, 1)), days);
  const prevTo = `${y - 1}${t.slice(4)}`;
  const prev = kpis(await accountSums(companyId, `${y - 1}-01-01`, prevTo), await openingBalances(companyId, addDays(prevTo, 1)), days);
  return { now, prev, period: `${y}-01-01 – ${t}` };
}

// ---------- Delade länkar ----------
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
export async function createShare(actor: Actor, o: { kind: 'report' | 'kpi'; reportId?: number; role?: string; days: number; label: string }) {
  if (![7, 30, 90].includes(o.days)) throw new ValidationError('Välj hur länge länken ska gälla');
  if (o.kind === 'report') await getReport(actor.companyId, o.reportId!);
  if (o.kind === 'kpi' && !(o.role && o.role in ROLE_KPIS)) throw new ValidationError('Välj vy');
  const token = randomBytes(24).toString('base64url');
  const [r] = await sql<{ id: number }[]>`INSERT INTO report_shares (token_hash, company_id, kind, report_id, role, label, expires_at, created_by)
    VALUES (${hash(token)}, ${actor.companyId}, ${o.kind}, ${o.reportId ?? null}, ${o.role ?? null}, ${o.label.trim().slice(0, 80)}, now() + ${o.days + ' days'}::interval, ${actor.userId}) RETURNING id`;
  await auditBy(sql, actor, 'share', o.kind === 'report' ? 'custom_report' : 'kpi', o.reportId ?? null, { share: r.id, days: o.days, label: o.label });
  return token;
}
export async function listShares(companyId: number) {
  return [...await sql<{ id: number; kind: string; report: string | null; role: string | null; label: string; expires: string; revoked: boolean; expired: boolean; views: number; by: string | null }[]>`
    SELECT s.id, s.kind, r.name AS report, s.role, s.label, to_char(s.expires_at,'YYYY-MM-DD') AS expires, s.revoked_at IS NOT NULL AS revoked, s.expires_at < now() AS expired, s.views, u.name AS by
    FROM report_shares s LEFT JOIN custom_reports r ON r.id = s.report_id LEFT JOIN users u ON u.id = s.created_by WHERE s.company_id = ${companyId} ORDER BY s.created_at DESC LIMIT 50`];
}
export async function revokeShare(actor: Actor, id: number) {
  const r = await sql`UPDATE report_shares SET revoked_at = now() WHERE id = ${id} AND company_id = ${actor.companyId} AND revoked_at IS NULL RETURNING id`;
  if (!r.length) throw new NotFoundError('Länken');
  await auditBy(sql, actor, 'revoke_share', 'report_share', id);
}
/** Öppen länk: giltig, inte återkallad. Räknar visningar. */
export async function resolveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [s] = await sql<{ id: number; company_id: number; kind: 'report' | 'kpi'; report_id: number | null; role: string | null; label: string; company: string; orgnr: string; expires: string }[]>`
    UPDATE report_shares s SET views = views + 1 FROM companies c WHERE s.token_hash = ${hash(token)} AND c.id = s.company_id AND s.revoked_at IS NULL AND s.expires_at > now()
    RETURNING s.id, s.company_id, s.kind, s.report_id, s.role, s.label, c.name AS company, c.orgnr, to_char(s.expires_at,'YYYY-MM-DD') AS expires`;
  return s ?? null;
}

/** Nyckeltal för användarens bolag sida vid sida (ägare, konsult eller revisor) */
export async function compareCompanies(userId: number) {
  // Samma behörighet som bolagets egen nyckeltalssida: läsrätt till bokföringen, och abonnemanget får inte vara spärrat
  const rows = await sql<{ id: number; name: string; role: string; permissions: string[] | null }[]>`SELECT c.id, c.name, m.role, m.permissions FROM companies c JOIN memberships m ON m.company_id = c.id
    WHERE m.user_id = ${userId} AND m.role IN ('owner','accountant','auditor') AND NOT c.is_demo
    UNION SELECT c.id, c.name, 'accountant', NULL FROM companies c JOIN firm_clients fc ON fc.company_id = c.id JOIN firm_members fm ON fm.firm_id = fc.firm_id
      WHERE fm.user_id = ${userId} AND NOT EXISTS (SELECT 1 FROM memberships m2 WHERE m2.company_id = c.id AND m2.user_id = ${userId})
    ORDER BY name LIMIT 50`;
  const { companyAccess } = await import('@/lib/server/auth');
  const out = [];
  for (const c of rows) {
    if (!canView(c.role, c.permissions, 'ledger')) continue;
    if ((await companyAccess(c.id)).state === 'locked') continue;
    out.push({ id: c.id, name: c.name, ...(await kpiView(c.id)) });
  }
  return out;
}
