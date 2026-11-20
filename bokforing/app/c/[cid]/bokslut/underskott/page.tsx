import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { deficits } from '@/lib/services/deficits';
import { setChange, setTaxable } from './actions';

export const dynamic = 'force-dynamic';

/** Underskottsavdrag år för år med belopps- och koncernbidragsspärr vid ägarförändring */
export default async function Deficits({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  if (company.company_type !== 'AB') return <div style={{ maxWidth: 760 }}><h1>Underskottsavdrag</h1><EmptyState icon="briefcase" title="Gäller aktiebolag">Spärrarna vid ägarförändring gäller aktiebolag. I en enskild firma rullas underskottet vidare i NE-bilagan.</EmptyState></div>;
  const d = await deficits(company.id);
  const last = d.rows[d.rows.length - 1];
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Underskottsavdrag</h1>
      <p className="small"><Link href={`/c/${company.id}/bokslut`}>← Bokslut</Link></p>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Outnyttjat underskott att rulla vidare</div><div className="value df-outgoing">{kr(last?.outgoing ?? 0)}</div></div>
        <div className="card stat"><div className="label">varav spärrat mot koncernbidrag</div><div className="value df-locked">{kr(last?.locked ?? 0)}</div></div>
      </div>
      <table className="df-years"><thead><tr><th>År</th><th className="num">Skattemässigt resultat</th><th className="num">Ingående underskott</th><th className="num">Utnyttjat</th><th className="num">Bortfallet</th><th className="num">Utgående underskott</th><th></th></tr></thead>
        <tbody>{d.rows.map((r) => (
          <tr key={r.start} className={`df-row ${r.change ? 'change' : ''}`} data-year={r.year}>
            <td>{r.start.slice(0, 4) === r.end.slice(0, 4) ? r.year : `${r.start.slice(0, 7)} – ${r.end.slice(0, 7)}`}{r.note && <div className="small muted df-note">{r.note}</div>}</td>
            <td className="num">{kr(r.taxable)}{r.adjusted && <span className="small muted"> (justerat)</span>}</td>
            <td className="num">{kr(r.incoming)}</td><td className="num df-used">{kr(r.usedOld + r.usedNew)}</td><td className="num df-cut">{kr(r.cut)}</td><td className="num df-out"><b>{kr(r.outgoing)}</b></td>
            <td><form action={setTaxable.bind(null, company.id, r.fyId)} className="row"><input name="taxable" placeholder="Justera" aria-label={`Skattemässigt resultat ${r.year}`} style={{ width: '8rem' }} /><button className="secondary small">Spara</button></form></td>
          </tr>))}</tbody></table>
      <p className="small muted">Det skattemässiga resultatet räknas som resultat före skatt plus ej avdragsgilla kostnader. Justera det om deklarationen innehåller fler justeringar. Utgående underskott förs in i INK2S som outnyttjat underskott från föregående år.</p>

      <section className="card stack df-change">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Ägarförändring</h2>
        <p className="small" style={{ margin: 0 }}>När någon får bestämmande inflytande (mer än 50 % av rösterna) får gamla underskott bara behållas upp till 200 % av köpeskillingen minus kapitaltillskott de två åren före (beloppsspärr),
          och de får inte kvittas mot mottagna koncernbidrag under ändringsåret och fem år därefter (koncernbidragsspärr).</p>
        {d.change && <p style={{ margin: 0 }}>Registrerad: {d.change.date}, köpeskilling {kr(d.change.price)} kr{d.change.contributions ? `, kapitaltillskott ${kr(d.change.contributions)} kr` : ''}{d.change.note ? ` – ${d.change.note}` : ''}.</p>}
        {d.transfers.length > 0 && <p className="small muted" style={{ margin: 0 }}>Från aktieboken: {d.transfers.map((t) => `${t.date} ${t.text}`).join(' · ')}</p>}
        <form action={setChange.bind(null, company.id)} className="row">
          <label>Datum<input type="date" name="date" defaultValue={d.change?.date ?? ''} required /></label>
          <label>Köpeskilling för det bestämmande inflytandet (kr)<input name="price" defaultValue={d.change ? (d.change.price / 100).toFixed(2).replace('.', ',') : ''} required /></label>
          <label>Kapitaltillskott två år före (kr)<input name="contributions" defaultValue={d.change ? (d.change.contributions / 100).toFixed(2).replace('.', ',') : '0'} /></label>
          <label>Notering<input name="note" maxLength={300} defaultValue={d.change?.note ?? ''} /></label>
          <div style={{ flex: '0 0 auto' }}><button>Spara ägarförändring</button></div>
        </form>
      </section>
    </div>
  );
}
