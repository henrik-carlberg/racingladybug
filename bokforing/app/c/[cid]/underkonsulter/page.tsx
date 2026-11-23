import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/subcontractors';
import { assignmentAction, invoiceAction, matchAction, reportAction } from './actions';

export const dynamic = 'force-dynamic';
const h = (n: number) => n.toLocaleString('sv-SE');

export default async function Subcontractors({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Underkonsulter</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Inhyrda konsulter kopplas till ett kunduppdrag med inköps- och kundpris per timme. Den rapporterade tiden vidarefaktureras med påslag, och underkonsultens faktura stäms av mot tiden.
        Varningen visar när underkonsulten har fakturerat fler timmar än som har vidarefakturerats.</p>
      {o.assignments.map((a) => (
        <section key={a.id} className="card stack sk-assignment" data-consultant={a.consultant}>
          <h2 style={{ margin: 0 }}>{a.consultant} <span className="small muted">{a.name} · {a.customer} · via {a.supplier}</span></h2>
          <p className="small">Inköp {kr(a.cost_rate)} kr/tim, kund {kr(a.bill_rate)} kr/tim (påslag {a.markup.toLocaleString('sv-SE')} %)</p>
          <div className="row">
            <div className="card stat"><div className="label">Vidarefakturerat</div><div className="value sk-revenue">{kr(a.result.revenue)}</div></div>
            <div className="card stat"><div className="label">Underkonsultens kostnad</div><div className="value sk-cost">{kr(a.result.cost)}</div></div>
            <div className="card stat"><div className="label">Marginal</div><div className="value sk-margin">{kr(a.result.margin)}</div></div>
          </div>
          {a.result.warning > 0 && <p className="sk-warning" style={{ color: 'var(--danger)' }}>Underkonsulten har fakturerat {h(a.result.warning)} timmar mer än som har vidarefakturerats.</p>}
          <table><thead><tr><th>Månad</th><th className="num">Rapporterat</th><th>Till kund</th><th>Underkonsultens faktura</th></tr></thead>
            <tbody>{a.periods.map((p) => <tr key={p.id} className="sk-period" data-period={p.period}><td>{p.period}</td><td className="num">{h(p.hours)} tim</td>
              <td>{p.invoice_id ? <Link href={`/c/${id}/fakturor/${p.invoice_id}`}>Fakturerad</Link> : <form action={invoiceAction.bind(null, id, p.id)}><button className="link">Vidarefakturera</button></form>}</td>
              <td className="small">{p.supplier_invoice_id ? `Faktura ${p.supplier_invoice}: ${h(p.supplier_hours ?? 0)} tim` : a.supplierInvoices.length > 0 ? <form action={matchAction.bind(null, id, p.id)} className="row" style={{ gap: '.25rem' }}>
                <select name="supplier_invoice_id">{a.supplierInvoices.map((s) => <option key={s.id} value={s.id}>{s.number} ({kr(s.net)} kr exkl. moms)</option>)}</select><button className="link">Stäm av</button></form> : 'Ingen faktura ännu'}</td></tr>)}
              {!a.periods.length && <tr><td colSpan={4} className="muted">Ingen tid rapporterad.</td></tr>}</tbody></table>
          <form action={reportAction.bind(null, id, a.id)} className="row">
            <label>Månad<input type="month" name="period" required /></label>
            <label>Timmar<input name="hours" inputMode="decimal" required style={{ width: '6rem' }} /></label>
            <button className="secondary">Registrera tid</button>
          </form>
        </section>))}
      <h2>Nytt uppdrag</h2>
      <form action={assignmentAction.bind(null, id)} className="card row">
        <label>Konsult<input name="consultant" required /></label>
        <label>Underkonsult (leverantör)<select name="supplier_id">{o.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Kund<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Uppdrag<input name="name" required /></label>
        <label>Inköpspris/tim (kr)<input name="cost_rate" inputMode="decimal" required style={{ width: '6rem' }} /></label>
        <label>Kundpris/tim (kr)<input name="bill_rate" inputMode="decimal" style={{ width: '6rem' }} /></label>
        <label>eller påslag %<input name="markup_pct" inputMode="decimal" style={{ width: '5rem' }} /></label>
        <button>Lägg upp uppdrag</button>
      </form>
    </div>
  );
}
