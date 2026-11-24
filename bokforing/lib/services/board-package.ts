import 'server-only';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { accountSums, openingBalances } from '@/lib/server/ledger';
import { addDays, today } from '@/lib/format';
import { formatAmount } from '@/lib/money';
import { sumRange } from '@/lib/monthly';
import { METRICS, fmtValue } from '@/lib/kpi-alerts';
import { packageHtml, period, type PackageData } from '@/lib/board-package';
import type { Actor } from './actor';
import { createDocument, sendDocument } from './documents';
import { metrics } from './kpi-alerts';
import { overview as boardOverview } from './board-meetings';
import { overview as icOverview } from './internal-control';
import { date, str } from './input';

async function build(companyId: number, from: string, to: string): Promise<PackageData> {
  const [co] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${companyId}`;
  const r = await accountSums(companyId, from, to);
  const revenue = -sumRange(r, 3000, 3999), costs = sumRange(r, 4000, 8999);
  const months: { y: number; m: number }[] = [];
  for (let d = from.slice(0, 7); d <= to.slice(0, 7);) { months.push({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) }); const n = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)); d = n.toISOString().slice(0, 7); }
  let bRev = 0, bCost = 0;
  for (const p of months) {
    const [b] = await sql<{ rev: number; cost: number }[]>`SELECT COALESCE(SUM(amount) FILTER (WHERE account < 4000), 0)::float8 AS rev, COALESCE(SUM(amount) FILTER (WHERE account >= 4000), 0)::float8 AS cost FROM account_budgets WHERE company_id = ${companyId} AND year = ${p.y} AND month = ${p.m}`;
    bRev += b.rev; bCost += b.cost;
  }
  const bal = await openingBalances(companyId, addDays(to, 1));
  const m = await metrics(companyId);
  const alerts = await sql<{ metric: keyof typeof METRICS; value: number | null }[]>`SELECT a.metric, e.value::float8 AS value FROM kpi_alert_events e JOIN kpi_alerts a ON a.id = e.alert_id WHERE e.company_id = ${companyId} AND e.cleared_at IS NULL AND a.active`;
  const board = await boardOverview(companyId);
  const ic = await icOverview(companyId);
  return {
    company: co.name, from, to,
    result: { revenue, costs, result: revenue - costs, budgetRevenue: bRev, budgetCosts: bCost, budgetResult: bRev - bCost },
    cash: sumRange(bal, 1900, 1999),
    kpis: (['solidity', 'quick', 'gross', 'operating', 'dso'] as const).map((k) => ({ label: METRICS[k].label, value: fmtValue(k, m[k]) })),
    alerts: alerts.map((a) => `${METRICS[a.metric].label} ${fmtValue(a.metric, a.value)}`),
    decisions: board.decisions.map((d) => ({ title: d.title, decision: d.decision, owner: d.owner, due: d.due_date, overdue: d.overdue })),
    control: { missing: ic.summary.missing, deviations: ic.controls.flatMap((c) => c.runs.filter((x) => !x.ok && x.performed_on >= from).map((x) => `${c.name} ${x.period}: ${x.deviation}`)) },
    risks: ic.risks.filter((x) => x.level === 'high').map((x) => ({ area: x.area, description: x.description, score: x.score })),
  };
}

export async function overview(companyId: number) {
  const list = await sql<{ id: number; from: string; to: string; data: PackageData; comment: string; document_id: number | null; doc_status: string | null; created_at: Date }[]>`
    SELECT p.id, to_char(p.period_from,'YYYY-MM-DD') AS from, to_char(p.period_to,'YYYY-MM-DD') AS to, p.data, p.comment, p.document_id, d.status AS doc_status, p.created_at
    FROM board_packages p LEFT JOIN documents d ON d.id = p.document_id AND d.company_id = p.company_id WHERE p.company_id = ${companyId} ORDER BY p.period_to DESC, p.id DESC LIMIT 24`;
  const comments = list.length ? await sql<{ package_id: number; name: string | null; body: string; created_at: Date }[]>`SELECT c.package_id, u.name, c.body, c.created_at FROM board_package_comments c LEFT JOIN users u ON u.id = c.user_id
    WHERE c.company_id = ${companyId} AND c.package_id IN ${sql(list.map((p) => p.id))} ORDER BY c.id` : [];
  return list.map((p) => ({ ...p, comments: comments.filter((c) => c.package_id === p.id) }));
}

export async function create(actor: Actor, input: Record<string, unknown>) {
  const kind = input.kind === 'quarter' ? 'quarter' : input.kind === 'custom' ? 'custom' : 'month';
  const p = kind === 'custom' ? { from: date(input, 'from', 'Från'), to: date(input, 'to', 'Till') } : period(kind, today());
  if (p.to < p.from) throw new ValidationError('Perioden slutar före den börjar');
  const data = await build(actor.companyId, p.from, p.to);
  const [r] = await sql<{ id: number }[]>`INSERT INTO board_packages ${sql({ company_id: actor.companyId, period_from: p.from, period_to: p.to, data: sql.json(data), comment: str(input, 'comment', { max: 4000 }), created_by: actor.userId })} RETURNING id`;
  await auditBy(sql, actor, 'board_package', 'board_package', r.id, { from: p.from, to: p.to });
  return { id: r.id, ...p };
}

/** Paketet skickas som dokument till ledamöterna, som kvitterar att de tagit del av det */
export async function send(actor: Actor, id: number, input: Record<string, unknown>) {
  const [p] = await sql<{ data: PackageData; comment: string; from: string; to: string; document_id: number | null }[]>`SELECT data, comment, to_char(period_from,'YYYY-MM-DD') AS from, to_char(period_to,'YYYY-MM-DD') AS to, document_id FROM board_packages WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Paketet');
  if (p.document_id) throw new ValidationError('Paketet är redan skickat');
  const signers = String(input.recipients ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20).map((l) => { const m = l.match(/^(.*?)[\s,;<]+([^\s<>]+@[^\s<>]+)>?$/); return m ? { name: m[1].trim() || m[2], email: m[2] } : null; });
  if (!signers.length || signers.some((s) => !s)) throw new ValidationError('Ange en mottagare per rad: namn och e-post');
  const doc = await createDocument(actor, { title: `Styrelsepaket ${p.from} – ${p.to}`, html: packageHtml(p.data, (n) => formatAmount(n), p.comment), source_module: 'styrelsepaket', source_id: id, signers });
  await sendDocument(actor, doc.id);
  await sql`UPDATE board_packages SET document_id = ${doc.id} WHERE id = ${id} AND company_id = ${actor.companyId}`;
  return signers.length;
}

export async function comment(actor: Actor, id: number, input: Record<string, unknown>) {
  const [p] = await sql`SELECT 1 FROM board_packages WHERE id = ${id} AND company_id = ${actor.companyId}`;
  if (!p) throw new NotFoundError('Paketet');
  await sql`INSERT INTO board_package_comments (package_id, company_id, user_id, body) VALUES (${id}, ${actor.companyId}, ${actor.userId}, ${str(input, 'body', { required: true, label: 'Kommentar', max: 4000 })})`;
}
