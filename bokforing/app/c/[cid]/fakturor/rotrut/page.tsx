import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { REDUCTION, COMBINED_MAX, formatPnr } from '@/lib/rotrut';
import { buyerTotals, listReductions } from '@/lib/services/rotrut';
import { decide, markRequested, undo } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  to_request: ['Att begära', 'warn'], requested: ['Begärd', ''], paid: ['Utbetald', 'ok'], partly_paid: ['Delvis beviljad', 'warn'], rejected: ['Avslagen', 'danger'],
};

export default async function RotRut({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const t = today();
  const year = t.slice(0, 4);
  const [all, buyers] = await Promise.all([listReductions(company.id), buyerTotals(company.id, year)]);
  const toRequest = all.filter((r) => r.status === 'to_request');
  const requested = all.filter((r) => r.status === 'requested');
  const done = all.filter((r) => !['to_request', 'requested'].includes(r.status));
  const b = `/c/${company.id}/fakturor`;
  const place = (r: (typeof all)[number]) => (r.type === 'rot' ? (r.property || `BRF ${r.brf_orgnr}, lgh ${r.apartment_no}`) : '–');
  return (
    <div>
      <h1>ROT och RUT</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">När kunden har betalat sin del begär du skattereduktionen i Skatteverkets e-tjänst <b>Rot och rut – företag</b> (logga in med e-legitimation på skatteverket.se).
        Uppgifterna nedan är de som e-tjänsten frågar efter. Begäran ska ha kommit in senast den 31 januari året efter att kunden betalade. Utbetalningen kommer till skattekontot.</p>

      <h2>Att begära ({toRequest.length})</h2>
      {toRequest.length === 0 ? <p className="small muted">Inget att begära just nu.</p> : (
        <form action={markRequested.bind(null, company.id)} className="stack">
          <div className="table-wrap"><table className="small">
            <thead><tr><th></th><th>Faktura</th><th>Köpare</th><th>Betald</th><th>Arbete</th><th className="num">Timmar</th><th className="num">Pris för arbetet</th><th className="num">Material m.m.</th>
              <th className="num">Betalt av köparen</th><th className="num">Begärt belopp</th><th>Fastighet / BRF</th><th>Senast</th></tr></thead>
            <tbody>{toRequest.map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" name="ids" value={r.id} defaultChecked aria-label={`Faktura ${r.number}`} /></td>
                <td><Link href={`${b}/${r.id}`}>{r.number}</Link> <span className="badge">{r.type.toUpperCase()}</span></td>
                <td>{r.customer}<div className="mono">{formatPnr(r.buyer_pnr)}</div></td>
                <td>{r.paid_date}</td><td>{r.work_type}</td><td className="num">{r.hours ? String(r.hours).replace('.', ',') : ''}</td>
                <td className="num">{kr(r.labour)}</td><td className="num">{kr(r.material)}</td><td className="num">{kr(r.customer_paid)}</td>
                <td className="num"><b>{kr(r.tax_reduction)}</b></td><td>{place(r)}</td>
                <td style={r.deadline && r.deadline <= t.slice(0, 4) + '-02-01' ? { color: 'var(--danger)' } : undefined}>{r.deadline}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row" style={{ alignItems: 'end' }}>
            <label style={{ flex: '0 0 180px' }}>Begärt den<input type="date" name="date" defaultValue={t} required /></label>
            <div style={{ flex: '0 0 auto' }}><button>Markera valda som begärda</button></div>
          </div>
        </form>
      )}

      <h2>Begärda – väntar på beslut ({requested.length})</h2>
      {requested.length === 0 ? <p className="small muted">Inga begäranden väntar på beslut.</p> : (
        <div className="table-wrap"><table className="small">
          <thead><tr><th>Faktura</th><th>Köpare</th><th>Begärd</th><th className="num">Begärt</th><th>Beslut från Skatteverket</th><th></th></tr></thead>
          <tbody>{requested.map((r) => (
            <tr key={r.id}>
              <td><Link href={`${b}/${r.id}`}>{r.number}</Link> <span className="badge">{r.type.toUpperCase()}</span></td><td>{r.customer}</td><td>{r.requested_on}</td>
              <td className="num">{kr(r.tax_reduction)}</td>
              <td>
                <form action={decide.bind(null, company.id, r.id)} className="row" style={{ alignItems: 'end', flexWrap: 'nowrap' }}>
                  <label>Utbetalt (kr)<input name="amount" inputMode="decimal" defaultValue={(r.tax_reduction / 100).toFixed(2).replace('.', ',')} style={{ width: 110 }} /></label>
                  <label>Datum<input type="date" name="date" defaultValue={t} /></label>
                  <label>Till<select name="account" defaultValue="1630"><option value="1630">Skattekontot (1630)</option><option value="1930">Bankkonto (1930)</option></select></label>
                  <button className="secondary">Registrera beslut</button>
                </form>
              </td>
              <td><form action={undo.bind(null, company.id, r.id)}><button className="link">Ångra</button></form></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {done.length > 0 && (
        <details><summary>Avslutade ({done.length})</summary>
          <table className="small"><tbody>{done.map((r) => (
            <tr key={r.id}><td><Link href={`${b}/${r.id}`}>{r.number}</Link></td><td>{r.customer}</td><td><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
              <td className="num">{kr(r.reduction_paid ?? 0)} av {kr(r.tax_reduction)}</td><td>{r.decided_on}</td>
              <td>{r.rest_invoice_id && <Link href={`${b}/${r.rest_invoice_id}`}>Faktura på mellanskillnaden</Link>}</td></tr>
          ))}</tbody></table>
        </details>
      )}

      <h2>Per köpare {year}</h2>
      <p className="small muted">Högst {kr(REDUCTION.rot.maxPerYear)} kr ROT och {kr(COMBINED_MAX)} kr ROT och RUT tillsammans per person och år. Köparen kan ha fått avdrag från andra företag – fråga hur mycket som finns kvar och ange det på fakturan.</p>
      <div className="table-wrap"><table className="small">
        <thead><tr><th>Köpare</th><th>Personnummer</th><th className="num">ROT</th><th className="num">RUT</th><th className="num">Kvar (hos oss)</th></tr></thead>
        <tbody>{buyers.map((x) => (
          <tr key={x.buyer_pnr}><td>{x.customer}</td><td className="mono">{formatPnr(x.buyer_pnr)}</td><td className="num">{kr(x.rot)}</td><td className="num">{kr(x.rut)}</td>
            <td className="num">{kr(Math.max(0, COMBINED_MAX - Number(x.rot) - Number(x.rut)))}</td></tr>
        ))}{buyers.length === 0 && <tr><td colSpan={5} className="muted">Inga ROT/RUT-fakturor i år.</td></tr>}</tbody>
      </table></div>
    </div>
  );
}
