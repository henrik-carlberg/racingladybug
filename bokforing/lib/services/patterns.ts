import 'server-only';
import { sql } from '@/lib/db';
import { kr, today as todayFn } from '@/lib/format';
import { daysBetween, monthlyPattern, normText, ordinal, plusDays } from '@/lib/patterns';

export interface Suggestion { key: string; title: string; text: string; href: string; action: string; icon: string }

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const monthName = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];

/** Förslag utifrån sådant som brukar hända varje månad: lön, leverantörsfakturor och verifikationer man bokför själv */
export async function patternSuggestions(companyId: number, opts: { can: (p: 'payroll' | 'purchasing' | 'ledger') => boolean; today?: string }): Promise<Suggestion[]> {
  const t = opts.today ?? todayFn();
  const since = plusDays(t, -190);
  const b = `/c/${companyId}`;
  const out: Suggestion[] = [];

  // Lön: brukar betalas ut samma dag varje månad
  if (opts.can('payroll')) {
    const runs = await sql<{ d: string }[]>`SELECT to_char(payment_date,'YYYY-MM-DD') AS d FROM payroll_runs WHERE company_id = ${companyId} AND payment_date >= ${since} ORDER BY payment_date`;
    const all = runs.map((r) => r.d);
    const p = monthlyPattern(all.filter((d) => d <= t));
    if (p && all.every((d) => d <= plusDays(p.next, -15) || d > plusDays(p.next, 15)) && daysBetween(t, p.next) <= 5 && daysBetween(p.next, t) <= 5) {
      out.push({ key: `payroll:${p.next.slice(0, 7)}`, icon: 'wallet', title: 'Dags för lön', href: `${b}/lon`, action: 'Kör lön',
        text: `Du brukar betala ut lön den ${ordinal(p.day)}. Lönekörningen för ${monthName(p.next)} är inte gjord än.` });
    }
  }

  // Leverantörer som brukar fakturera varje månad men inte har gjort det än
  if (opts.can('purchasing')) {
    const rows = await sql<{ id: number; name: string; d: string }[]>`
      SELECT s.id, s.name, to_char(si.invoice_date,'YYYY-MM-DD') AS d FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
      WHERE si.company_id = ${companyId} AND si.invoice_date >= ${since} ORDER BY si.invoice_date`;
    const by = new Map<number, { name: string; dates: string[] }>();
    for (const r of rows) { const x = by.get(r.id) ?? { name: r.name, dates: [] }; x.dates.push(r.d); by.set(r.id, x); }
    for (const [id, x] of by) {
      const p = monthlyPattern(x.dates);
      if (!p) continue;
      const late = daysBetween(p.next, t);
      if (late < 5 || late > 25) continue;
      out.push({ key: `supplier:${id}:${p.next.slice(0, 7)}`, icon: 'inbox', title: `Saknas en faktura från ${x.name}?`, href: `${b}/leverantorsfakturor/ny?leverantor=${id}`, action: 'Registrera fakturan',
        text: `${x.name} brukar fakturera runt den ${ordinal(p.day)} varje månad. Fakturan för ${monthName(p.next)} har inte kommit in.` });
    }
  }

  // Verifikationer man bokför själv varje månad (t.ex. hyra som dras via autogiro)
  if (opts.can('ledger')) {
    const vs = await sql<{ id: number; d: string; description: string; amount: number }[]>`
      SELECT v.id, to_char(v.date,'YYYY-MM-DD') AS d, v.description, (SELECT SUM(debit) FROM voucher_lines WHERE voucher_id = v.id)::bigint AS amount
      FROM vouchers v WHERE v.company_id = ${companyId} AND v.date >= ${since} AND v.source_type = 'manual'
        AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.corrects_id = v.id) ORDER BY v.date`;
    const by = new Map<string, (typeof vs)[number][]>();
    for (const v of vs) { const k = normText(v.description); if (k.length < 3) continue; by.set(k, [...(by.get(k) ?? []), v]); }
    for (const list of by.values()) {
      const p = monthlyPattern(list.map((v) => v.d));
      if (!p) continue;
      const late = daysBetween(p.next, t);
      if (late < 0 || late > 20) continue;
      const lastV = list[list.length - 1];
      out.push({ key: `voucher:${lastV.id}:${p.next.slice(0, 7)}`, icon: 'ledger', title: `Bokför ”${lastV.description}” igen?`, href: `${b}/verifikationer/ny?kopiera=${lastV.id}`, action: 'Bokför för ' + monthName(p.next),
        text: `Du har bokfört den varje månad runt den ${ordinal(p.day)}, senast ${kr(Number(lastV.amount))}. Konton och belopp fylls i som förra gången.` });
    }
  }

  if (!out.length) return out;
  const dismissed = new Set((await sql<{ key: string }[]>`SELECT key FROM suggestion_dismissals WHERE company_id = ${companyId} AND key IN ${sql(out.map((s) => s.key))}`).map((r) => r.key));
  return out.filter((s) => !dismissed.has(s.key));
}

export async function dismissSuggestion(companyId: number, userId: number, key: string) {
  if (!/^(payroll|supplier|voucher):[\d:-]+$/.test(key)) return;
  await sql`INSERT INTO suggestion_dismissals (company_id, key, user_id) VALUES (${companyId}, ${key}, ${userId}) ON CONFLICT DO NOTHING`;
}
