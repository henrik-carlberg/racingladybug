import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { overview } from '@/lib/services/sanctions';
import { reviewAction, screenAction, uploadAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { clear: 'Ingen träff', potential: 'Möjlig träff – granska', false_positive: 'Falsk träff', confirmed: 'Bekräftad träff – stoppad' };
const PARTY: Record<string, string> = { customer: 'Kund', supplier: 'Leverantör' };
const dt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '–');

export default async function Sanctions({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const hits = o.screenings.filter((s) => s.status !== 'clear');
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Sanktionslistekontroll</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Det är förbjudet att tillhandahålla tillgångar eller ekonomiska resurser till personer och företag som finns på EU:s och FN:s sanktionslistor.
        Ladda ner den konsoliderade listan som CSV (EU: <code>webgate.ec.europa.eu/fsd/fsf</code>, FN: säkerhetsrådets lista) och ladda upp den här. Alla kunder och leverantörer jämförs med listan – även vid felstavning, omvänd ordning och olika bolagsformer.
        En bekräftad träff stoppar fakturering och betalning. Kontrollerna sparas som dokumentation, till exempel för penningtvättslagen.</p>
      <div className="card small sn-summary">Listor: {o.lists.map((l) => `${l.source} (${l.entries} namn, ${dt(l.uploaded_at)})`).join(' · ') || 'ingen uppladdad'} · {o.parties} motparter · senaste kontroll {dt(o.lastRun)}</div>
      <form action={uploadAction.bind(null, id)} className="card row sn-upload">
        <label>Källa<select name="source"><option value="EU">EU:s konsoliderade lista</option><option value="UN">FN:s sanktionslista</option><option value="OTHER">Annan lista</option></select></label>
        <label>CSV-fil<input type="file" name="file" accept=".csv,text/csv" required /></label>
        <button>Ladda upp och kontrollera</button>
      </form>
      {o.lists.length > 0 && <form action={screenAction.bind(null, id)}><button className="secondary">Kontrollera alla kunder och leverantörer igen</button></form>}

      <h2>Träffar</h2>
      {hits.map((s) => <div key={s.id} className="card small stack sn-hit" data-name={s.party_name} data-status={s.status}>
        <div><strong>{s.party_name}</strong> ({PARTY[s.party_type]}) · {STATUS[s.status]}{s.reviewed_at && ` ${dt(s.reviewed_at)}`}</div>
        <ul>{s.hits.map((h) => <li key={h.name}>{h.name} – {h.score} % likhet</li>)}</ul>
        {s.note && <div>Bedömning: {s.note}</div>}
        {s.status === 'potential' && <form action={reviewAction.bind(null, id, s.id)} className="row" style={{ gap: '.25rem' }}>
          <select name="decision"><option value="false_positive">Falsk träff (annan person eller annat företag)</option><option value="confirmed">Sann träff – stoppa</option></select>
          <input name="note" placeholder="Motivering (t.ex. annat födelsedatum eller org.nr)" required style={{ width: '20rem' }} /><button className="link">Spara bedömning</button></form>}
      </div>)}
      {!hits.length && <p className="muted">Inga träffar.</p>}
      <p className="small muted">{o.screenings.filter((s) => s.status === 'clear').length} motparter utan träff.</p>
    </div>
  );
}
