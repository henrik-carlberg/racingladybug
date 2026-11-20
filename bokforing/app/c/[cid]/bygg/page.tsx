import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { ATA_LABEL, signed } from '@/lib/construction';
import { changeOrders, openInvoices, retentions } from '@/lib/services/construction';
import { positions } from '@/lib/services/poc';
import { addAta, decideAta, release, retainCustomer, retainSupplier } from './actions';

export const dynamic = 'force-dynamic';

export default async function Construction({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const c = ctx.company;
  const t = today();
  const [ps, os, rs, open] = await Promise.all([positions(c.id, t), changeOrders(c.id), retentions(c.id), openInvoices(c.id)]);
  const outstanding = (side: string) => rs.filter((r) => r.side === side && !r.released_on).reduce((a, r) => a + r.amount, 0);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Bygg och entreprenad</h1>
      <p className="muted">ÄTA-arbeten mot avtalad kontraktssumma, innehållna belopp hos kunder och till underentreprenörer, och kontroll av omvänd byggmoms per fakturarad (visas på fakturautkastet).</p>
      <Flash searchParams={searchParams} />

      <h2>ÄTA-arbeten</h2>
      {ps.length === 0 && <p className="small">Inga fastprisuppdrag. Lägg upp ett under <Link href={`/c/${c.id}/successiv`}>Fastprisuppdrag</Link>.</p>}
      {ps.map((p) => {
        const mine = os.filter((o) => o.contract_id === p.id);
        return (
          <div key={p.id} className="card stack ata-contract">
            <div className="row"><b>{p.name}</b>
              <span className="small">Avtalat {kr(p.base_value)} kr · godkända ÄTA <span className="ata-approved">{kr(p.ata_value)}</span> kr · kontraktssumma nu <b className="ata-total">{kr(p.value)}</b> kr{p.ata_pending_count > 0 && <> · {p.ata_pending_count} väntar på beslut ({kr(p.ata_pending)} kr)</>}</span></div>
            {mine.length > 0 && <table className="ata"><thead><tr><th>Nr</th><th>Typ</th><th>Beskrivning</th><th className="num">Belopp</th><th className="num">Kostnad</th><th>Status</th><th></th></tr></thead>
              <tbody>{mine.map((o) => (
                <tr key={o.id} className="ata-row"><td>{o.no}</td><td>{ATA_LABEL[o.kind]}</td><td>{o.description}</td><td className="num">{kr(signed(o.kind, o.amount))}</td><td className="num">{kr(signed(o.kind, o.cost))}</td>
                  <td className="ata-status">{o.status === 'proposed' ? 'Väntar' : o.status === 'approved' ? `Godkänd ${o.decided_on}` : `Avslagen ${o.decided_on}`}</td>
                  <td>{o.status === 'proposed' && p.status === 'open' && <form action={decideAta.bind(null, c.id, o.id)} className="row">
                    <input type="date" name="decided_on" aria-label="Beslutsdag" defaultValue={t} />
                    <button name="decision" value="approve" className="secondary small">Godkänn</button><button name="decision" value="reject" className="link small">Avslå</button></form>}</td></tr>))}</tbody></table>}
            {p.status === 'open' && <form action={addAta.bind(null, c.id, p.id)} className="row">
              <label>Typ<select name="kind"><option value="tillagg">Tilläggsarbete</option><option value="andring">Ändringsarbete</option><option value="avgaende">Avgående arbete</option></select></label>
              <label style={{ flex: '2 1 220px' }}>Beskrivning<input name="description" required /></label>
              <label>Belopp (kr)<input name="amount" inputMode="decimal" required style={{ width: 110 }} /></label>
              <label>Beräknad kostnad (kr)<input name="cost" inputMode="decimal" style={{ width: 110 }} /></label>
              <button className="secondary">Ny ÄTA</button></form>}
          </div>);
      })}

      <h2>Innehållna belopp</h2>
      <p className="small muted">Kunden håller inne t.ex. 5–10 % till slutbesiktningen: beloppet flyttas från kundfordringar (1510) till 1682 och fakturan räknas som reglerad för den delen. Innehåller ni själva en del av en underentreprenörs faktura förs den till 2446. Utestående: hos kunder <b className="ret-customer">{kr(outstanding('customer'))}</b> kr, till leverantörer <b className="ret-supplier">{kr(outstanding('supplier'))}</b> kr.</p>
      <div className="row" style={{ alignItems: 'stretch' }}>
        <form action={retainCustomer.bind(null, c.id)} className="card stack" style={{ flex: "1 1 380px" }}>
          <b>Kunden håller inne</b>
          <label>Kundfaktura<select name="invoice_id" required>{open.customer.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
          <div className="row"><label>Andel %<input name="pct" defaultValue="10" inputMode="decimal" style={{ width: 70 }} /></label><label>Datum<input type="date" name="date" defaultValue={t} /></label><label>Släpps efter<input type="date" name="release_after" /></label></div>
          <label>Anteckning<input name="note" placeholder="T.ex. till slutbesiktning" /></label>
          <button className="secondary" disabled={!open.customer.length}>Bokför innehållet belopp</button>
        </form>
        <form action={retainSupplier.bind(null, c.id)} className="card stack" style={{ flex: "1 1 380px" }}>
          <b>Vi håller inne hos underentreprenör</b>
          <label>Leverantörsfaktura<select name="supplier_invoice_id" required>{open.supplier.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
          <div className="row"><label>Andel %<input name="pct" defaultValue="10" inputMode="decimal" style={{ width: 70 }} /></label><label>Datum<input type="date" name="date" defaultValue={t} /></label><label>Släpps efter<input type="date" name="release_after" /></label></div>
          <label>Anteckning<input name="note" /></label>
          <button className="secondary" disabled={!open.supplier.length}>Bokför innehållet belopp</button>
        </form>
      </div>
      <table className="retentions"><thead><tr><th>Datum</th><th>Part</th><th>Faktura</th><th className="num">Andel</th><th className="num">Belopp</th><th>Släpps</th><th></th></tr></thead>
        <tbody>{rs.map((r) => (
          <tr key={r.id} className={`retention-row ${r.side}`}><td>{r.date}</td><td>{r.side === 'customer' ? 'Kund: ' : 'Leverantör: '}{r.counterpart}</td><td>{r.ref}</td><td className="num">{r.pct.toLocaleString('sv-SE')} %</td><td className="num">{kr(r.amount)}</td>
            <td>{r.released_on ? `Frisläppt ${r.released_on}` : r.release_after ?? '–'}{r.note && <div className="small muted">{r.note}</div>}</td>
            <td>{!r.released_on && <form action={release.bind(null, c.id, r.id)} className="row"><input type="date" name="date" aria-label="Datum" defaultValue={t} /><button className="secondary small">{r.side === 'customer' ? 'Kunden har betalat' : 'Betala ut'}</button></form>}</td></tr>))}</tbody></table>
    </div>
  );
}
