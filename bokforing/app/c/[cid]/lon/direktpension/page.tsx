import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/direct-pension';
import { addCommitment, payPension, valuate } from './actions';

export const dynamic = 'force-dynamic';

/** Direktpension enligt tryggandelagen */
export default async function DirectPension({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const t = today();
  const year = Number(t.slice(0, 4));
  const o = await overview(company.id, year);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Direktpension</h1>
      <p className="small"><Link href={`/c/${company.id}/lon`}>← Lön</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Med direktpension behåller bolaget pengarna och redovisar en pensionsskuld enligt tryggandelagen (2210). Skulden räknas upp varje år till kapitalvärdet, och särskild löneskatt (24,26 %) betalas på förändringen.
        Avsättningen är avdragsgill bara om åtagandet är kreditförsäkrat, t.ex. hos PRI. Skulden redovisas i noten Avsättningar i årsredovisningen.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Pensionsskuld</div><div className="value dp-total">{kr(o.total)}</div></div>
        <div className="card stat"><div className="label">Ej avdragsgill avsättning {year}</div><div className="value dp-nondeductible">{kr(o.nonDeductible)}</div></div>
      </div>
      <table className="dp-list"><tbody>{o.rows.map((r) => (
        <tr key={r.id} className="dp-row" data-person={r.person}><td>{r.person}<div className="small muted">{r.insured ? 'Kreditförsäkrad' : 'Inte kreditförsäkrad – avsättningen är inte avdragsgill'}</div></td><td className="num dp-liability">{kr(r.liability)}</td>
          <td><form action={valuate.bind(null, company.id, r.id)} className="row"><input type="date" name="date" defaultValue={`${year}-12-31`} aria-label="Värderingsdag" /><input name="capital_value" placeholder="Kapitalvärde (kr)" aria-label="Kapitalvärde" style={{ width: '9rem' }} /><button className="secondary small">Räkna upp</button></form>
            <form action={payPension.bind(null, company.id, r.id)} className="row"><input type="date" name="date" defaultValue={t} aria-label="Datum" /><input name="amount" placeholder="Utbetalt (kr)" aria-label="Utbetalt" style={{ width: '9rem' }} /><button className="secondary small">Utbetalning</button></form></td></tr>))}
        {!o.rows.length && <tr><td className="muted">Inga pensionsåtaganden.</td></tr>}</tbody></table>
      <form action={addCommitment.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Person<input name="person" required maxLength={200} /></label>
        <label>Beskrivning<input name="description" maxLength={300} placeholder="T.ex. ålderspension från 65 år" /></label>
        <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="insured" /> Kreditförsäkrad (PRI)</label>
        <div style={{ flex: '0 0 auto' }}><button>Registrera åtagande</button></div>
      </form>
    </div>
  );
}
