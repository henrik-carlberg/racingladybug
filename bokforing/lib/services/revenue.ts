import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { createVoucher } from '@/lib/server/ledger';
import { fromSigned } from '@/lib/ledger-lines';
import { monthEnd, today } from '@/lib/format';
import { DEFERRED_REVENUE, deferral, metrics, releaseLines } from '@/lib/revenue';
import type { Actor } from './actor';
import { date } from './input';

const addMonth = (p: string, n: number) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

/** Tjänsteperiod för fakturan. Är fakturan redan bokförd periodiseras den direkt. */
export async function setServicePeriod(actor: Actor, invoiceId: number, input: Record<string, unknown>) {
  const from = date(input, 'service_from', 'Från');
  const to = date(input, 'service_to', 'Till');
  if (to < from) throw new ValidationError('Tjänsteperioden slutar före start');
  if (from.slice(0, 7) === to.slice(0, 7)) throw new ValidationError('Perioden ryms i en månad – då behövs ingen periodisering');
  const [inv] = await sql<{ status: string; deferred: boolean }[]>`SELECT status, EXISTS (SELECT 1 FROM invoice_deferrals d WHERE d.invoice_id = i.id) AS deferred
    FROM invoices i WHERE i.id = ${invoiceId} AND i.company_id = ${actor.companyId}`;
  if (!inv) throw new NotFoundError('Fakturan');
  if (inv.deferred) throw new ConflictError('Fakturan är redan periodiserad');
  await sql`UPDATE invoices SET service_from = ${from}, service_to = ${to} WHERE id = ${invoiceId}`;
  await auditBy(sql, actor, 'service_period', 'invoice', invoiceId, { from, to });
  if (inv.status !== 'draft') return deferInvoice(actor, invoiceId);
  return null;
}

/** Periodiserar en bokförd faktura: framtida månaders intäkt flyttas till 2970 och läggs i intäktsplanen */
export async function deferInvoice(actor: Actor, invoiceId: number) {
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ status: string; invoice_date: string; service_from: string | null; service_to: string | null; customer_id: number; total_net: number; credit: boolean; number: number | null; voucher_id: number | null }[]>`
      SELECT status, voucher_id, to_char(invoice_date,'YYYY-MM-DD') AS invoice_date, to_char(service_from,'YYYY-MM-DD') AS service_from, to_char(service_to,'YYYY-MM-DD') AS service_to,
        customer_id, total_net::float8 AS total_net, credit_of_id IS NOT NULL AS credit, invoice_number AS number
      FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId} FOR UPDATE`;
    if (!inv) throw new NotFoundError('Fakturan');
    if (inv.status === 'draft' || inv.status === 'credited' || inv.credit) throw new ValidationError('Bara bokförda fakturor (inte krediterade) periodiseras');
    if (!inv.service_from || !inv.service_to) throw new ValidationError('Ange tjänsteperioden först');
    if (!inv.voucher_id) throw new ValidationError('Fakturan är inte intäktsförd ännu (kontantmetoden) – periodisering görs först när intäkten bokförs');
    const [done] = await tx`SELECT 1 FROM invoice_deferrals WHERE invoice_id = ${invoiceId}`;
    if (done) throw new ConflictError('Fakturan är redan periodiserad');
    const raw = await tx<{ account: number; net: number }[]>`SELECT account_number AS account, ROUND(quantity * unit_price)::float8 AS net FROM invoice_lines WHERE invoice_id = ${invoiceId} AND account_number BETWEEN 3000 AND 3799`;
    const sum = raw.reduce((s, l) => s + l.net, 0);
    if (!sum) throw new ValidationError('Fakturan har inga intäktsrader');
    // Raderna i fakturans valuta räknas om till bokfört belopp i kronor
    const lines = raw.map((l) => ({ account: l.account, net: Math.round((l.net / sum) * inv.total_net) }));
    lines[lines.length - 1].net += inv.total_net - lines.reduce((s, l) => s + l.net, 0);
    const r = deferral(lines, inv.service_from, inv.service_to, inv.invoice_date.slice(0, 7));
    await tx`INSERT INTO accounts (company_id, number, name) VALUES (${actor.companyId}, ${DEFERRED_REVENUE}, 'Förutbetalda intäkter') ON CONFLICT DO NOTHING`;
    const v = r.lines.length ? await createVoucher(tx, { actor, date: inv.invoice_date, description: `Periodisering faktura ${inv.number ?? ''}: ${inv.service_from} – ${inv.service_to}`, lines: fromSigned(r.lines), sourceType: 'revenue_deferral', sourceId: invoiceId }) : null;
    await tx`INSERT INTO invoice_deferrals (invoice_id, company_id, voucher_id, deferred) VALUES (${invoiceId}, ${actor.companyId}, ${v?.id ?? null}, ${r.deferred})`;
    for (const s of r.schedules) await tx`INSERT INTO revenue_schedules ${tx({ company_id: actor.companyId, invoice_id: invoiceId, customer_id: inv.customer_id, account: s.account, period: s.period, amount: s.amount, posted: s.now, voucher_id: s.now ? v?.id ?? null : null })}`;
    await auditBy(tx, actor, 'defer', 'invoice', invoiceId, { deferred: r.deferred });
    return { deferred: r.deferred, months: new Set(r.schedules.map((s) => s.period)).size };
  });
}

/** När en faktura med tjänsteperiod bokförs periodiseras den automatiskt */
export async function deferIfNeeded(actor: Actor, invoiceId: number) {
  const [i] = await sql<{ ok: boolean }[]>`SELECT service_from IS NOT NULL AND service_to IS NOT NULL AND voucher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoice_deferrals d WHERE d.invoice_id = invoices.id) AS ok
    FROM invoices WHERE id = ${invoiceId} AND company_id = ${actor.companyId}`;
  if (i?.ok) await deferInvoice(actor, invoiceId);
}

/** Krediterad faktura: det som ännu inte intäktsförts förs tillbaka från 2970 och intäktsplanen tas bort */
export async function cancelForCredit(actor: Actor, invoiceId: number, creditDate: string) {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: number; account: number; amount: number }[]>`DELETE FROM revenue_schedules WHERE company_id = ${actor.companyId} AND invoice_id = ${invoiceId} AND NOT posted
      RETURNING id, account, amount::float8 AS amount`;
    if (!rows.length) return 0;
    await createVoucher(tx, { actor, date: creditDate, description: 'Kreditering: återstående förutbetalda intäkter förs tillbaka', lines: fromSigned(releaseLines(rows)), sourceType: 'revenue_release', sourceId: invoiceId });
    await auditBy(tx, actor, 'revenue_cancel', 'invoice', invoiceId, { months: rows.length });
    return rows.length;
  });
}

/** Månadens del förs från förutbetalda intäkter till intäktskontot (en verifikation per månad). Bara avslutade månader och innevarande månad på sista dagen. */
export async function postDue(actor: Actor, upTo?: string) {
  const t = today();
  const last = upTo && upTo <= t.slice(0, 7) ? upTo : (monthEnd(t.slice(0, 7)) === t ? t.slice(0, 7) : addMonth(t.slice(0, 7), -1));
  const due = await sql<{ id: number; period: string; account: number; amount: number }[]>`SELECT id, period, account, amount::float8 AS amount FROM revenue_schedules
    WHERE company_id = ${actor.companyId} AND NOT posted AND period <= ${last} ORDER BY period, id`;
  const byPeriod = new Map<string, { id: number; period: string; account: number; amount: number }[]>();
  for (const r of due) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  let n = 0;
  for (const [p, rows] of byPeriod) {
    await sql.begin(async (tx) => {
      const claimed = await tx<{ id: number }[]>`UPDATE revenue_schedules SET posted = true WHERE id IN ${tx(rows.map((r) => r.id))} AND NOT posted RETURNING id`;
      if (claimed.length !== rows.length) throw new ConflictError('Intäktsplanen ändrades samtidigt – försök igen');
      const end = monthEnd(p) < t ? monthEnd(p) : t;
      const v = await createVoucher(tx, { actor, date: end, description: `Periodiserade intäkter ${p}`, lines: fromSigned(releaseLines(rows)), sourceType: 'revenue_release' });
      await tx`UPDATE revenue_schedules SET voucher_id = ${v.id} WHERE id IN ${tx(rows.map((r) => r.id))}`;
    });
    n++;
  }
  if (n) await auditBy(sql, actor, 'revenue_release', 'company', actor.companyId, { months: n });
  return n;
}

export async function postDueAll() {
  let n = 0;
  for (const r of await sql<{ company_id: number; user_id: number }[]>`SELECT DISTINCT ON (s.company_id) s.company_id, m.user_id FROM revenue_schedules s
      JOIN memberships m ON m.company_id = s.company_id AND m.role = 'owner' WHERE NOT s.posted ORDER BY s.company_id, m.user_id`)
    n += await postDue({ companyId: r.company_id, userId: r.user_id, apiKeyId: null, role: 'owner' }).catch((e) => { console.error('revenue', r.company_id, e instanceof Error ? e.message : e); return 0; });
  return n;
}

export async function overview(companyId: number) {
  const t = today().slice(0, 7);
  const rows = await sql<{ customer_id: number; name: string; period: string; amount: number }[]>`
    SELECT s.customer_id, c.name, s.period, SUM(s.amount)::float8 AS amount FROM revenue_schedules s JOIN customers c ON c.id = s.customer_id
    WHERE s.company_id = ${companyId} GROUP BY s.customer_id, c.name, s.period`;
  const byCustomer = new Map<number, Map<string, number>>();
  const names = new Map<number, string>();
  for (const r of rows) { names.set(r.customer_id, r.name); (byCustomer.get(r.customer_id) ?? byCustomer.set(r.customer_id, new Map()).get(r.customer_id)!).set(r.period, r.amount); }
  const months = Array.from({ length: 12 }, (_, i) => addMonth(t, i - 11));
  const series = months.map((p) => ({ period: p, ...metrics(byCustomer, p, addMonth(p, -1)) }));
  const [bal] = await sql<{ open: number }[]>`SELECT COALESCE(SUM(amount) FILTER (WHERE NOT posted), 0)::float8 AS open FROM revenue_schedules WHERE company_id = ${companyId}`;
  const customers = [...byCustomer].map(([id, m]) => ({ id, name: names.get(id)!, mrr: m.get(t) ?? 0, future: [...m].filter(([p]) => p > t).reduce((s, [, v]) => s + v, 0) })).sort((a, b) => b.mrr - a.mrr);
  const invoices = await sql<{ id: number; number: number | null; customer: string; from: string; to: string; deferred: number | null }[]>`
    SELECT i.id, i.invoice_number AS number, c.name AS customer, to_char(i.service_from,'YYYY-MM-DD') AS from, to_char(i.service_to,'YYYY-MM-DD') AS to, d.deferred::float8 AS deferred
    FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN invoice_deferrals d ON d.invoice_id = i.id
    WHERE i.company_id = ${companyId} AND i.service_from IS NOT NULL ORDER BY i.service_from DESC LIMIT 100`;
  return { current: series[series.length - 1], series, customers, invoices, deferredBalance: bal.open };
}
