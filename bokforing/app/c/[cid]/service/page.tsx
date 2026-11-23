import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { CAUSES, lineTotal } from '@/lib/service-cases';
import { overview } from '@/lib/services/service-cases';
import { closeAction, lineAction, openAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Service({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Service- och garantiärenden</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Garantin räknas från fakturadatum. Inom garantin tas kostnaden för arbete och material i anspråk ur garantiavsättningen (2220); utanför garantin blir servicen ett fakturautkast till kunden.
        Utfallet ger ett förslag till garantiavsättning i bokslutet.</p>
      <div className="row">
        <div className="card stat"><div className="label">Garantikostnad 12 mån</div><div className="value sc-costs">{kr(o.costs)}</div></div>
        <div className="card stat"><div className="label">Försäljning 12 mån</div><div className="value">{kr(o.sales)}</div></div>
        <div className="card stat"><div className="label">Förslag till garantiavsättning</div><div className="value sc-rate">{o.rate != null ? `${o.rate.toLocaleString('sv-SE')} %` : '–'}</div></div>
      </div>
      <table className="sc-list"><thead><tr><th>Ärende</th><th>Kund</th><th>Vara</th><th>Garanti</th><th>Fel</th><th>Arbete och material</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.cases.map((c) => (
          <tr key={c.id} className="sc-row" data-item={c.item} data-status={c.status}><td>{c.id}<div className="small muted">{c.opened_on}</div></td><td>{c.customer}</td>
            <td>{c.item}{c.serial && <div className="small muted">{c.serial}</div>}{c.invoice_number && <div className="small muted">Faktura {c.invoice_number}</div>}</td>
            <td className="small sc-warranty">{c.in_warranty ? `Inom garantin t.o.m. ${c.until}` : c.until ? `Utgick ${c.until}` : 'Ingen garanti'}</td>
            <td className="small">{c.fault}<div className="muted">{CAUSES[c.cause]}</div></td>
            <td className="small">{c.lines.map((l) => <div key={l.id}>{l.kind === 'labor' ? 'Arbete' : 'Material'}: {l.description} {l.quantity} × {kr(l.unit_price)} = {kr(lineTotal(l))}</div>)}{c.status === 'closed' && <div><b>{kr(c.cost_total)} kr</b></div>}</td>
            <td className="small">{c.status === 'open' ? 'Öppet' : `Avslutat ${c.closed_on}`}{c.invoice_out_id && <div><Link href={`/c/${id}/fakturor/${c.invoice_out_id}`}>Faktura</Link></div>}</td>
            <td>{c.status === 'open' && <div className="stack" style={{ gap: '.25rem' }}>
              <form action={lineAction.bind(null, id, c.id)} className="row" style={{ gap: '.25rem' }}>
                <select name="kind"><option value="labor">Arbete</option><option value="material">Material</option></select>
                <input name="description" placeholder="Beskrivning" required style={{ width: '8rem' }} /><input name="quantity" placeholder="Antal" defaultValue="1" style={{ width: '4rem' }} />
                <input name="unit_price" placeholder="À-pris" inputMode="decimal" style={{ width: '6rem' }} /><button className="link">Lägg till</button></form>
              <form action={closeAction.bind(null, id, c.id)} className="row" style={{ gap: '.25rem' }}>
                {c.in_warranty && o.provisions.length > 0 && <select name="provision_id">{o.provisions.map((p) => <option key={p.id} value={p.id}>{p.description} ({kr(p.balance)} kr kvar)</option>)}<option value="">Utan avsättning</option></select>}
                <input type="hidden" name="date" value={t} /><button className="link">Avsluta ärendet</button></form></div>}</td></tr>))}
          {!o.cases.length && <tr><td colSpan={8} className="muted">Inga ärenden.</td></tr>}</tbody></table>
      <h2>Nytt ärende</h2>
      <form action={openAction.bind(null, id)} className="card row">
        <label>Kund<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Faktura (såld)<select name="invoice_id"><option value="">–</option>{o.invoices.map((i) => <option key={i.id} value={i.id}>{i.number} ({i.date})</option>)}</select></label>
        <label>Vara<input name="item" required /></label>
        <label>Serienummer<input name="serial" /></label>
        <label>Garanti (månader)<input name="warranty_months" defaultValue="12" inputMode="numeric" style={{ width: '5rem' }} /></label>
        <label>Fel<input name="fault" required /></label>
        <label>Orsak<select name="cause">{Object.entries(CAUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button>Registrera ärende</button>
      </form>
      <h2>Per vara</h2>
      <table className="sc-items"><thead><tr><th>Vara</th><th className="num">Ärenden</th><th className="num">Inom garantin</th><th className="num">Garantikostnad</th><th>Vanligaste orsak</th></tr></thead>
        <tbody>{o.items.map((i) => <tr key={i.item} data-item={i.item}><td>{i.item}</td><td className="num">{i.cases}</td><td className="num">{i.warranty}</td><td className="num">{kr(i.cost)}</td><td>{CAUSES[i.top]}</td></tr>)}
          {!o.items.length && <tr><td colSpan={5} className="muted">Ingen statistik ännu.</td></tr>}</tbody></table>
    </div>
  );
}
