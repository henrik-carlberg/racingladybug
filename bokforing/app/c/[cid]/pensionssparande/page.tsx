import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/ef-pension';
import { pay, saveSettings } from './actions';

export const dynamic = 'force-dynamic';
const krIn = (o: number) => String(o / 100).replace('.', ',');

/** Pensionssparande med avdrag för enskild näringsidkare */
export default async function EfPension({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  if (company.company_type !== 'EF') return <div style={{ maxWidth: 800 }}><h1>Pensionssparande</h1><p className="ep-not-ef">Avdrag för eget pensionssparande i näringsverksamheten gäller enskild näringsidkare. I ett aktiebolag betalar bolaget tjänstepension till ägaren som anställd.</p></div>;
  const year = /^\d{4}$/.test(String(sp.ar ?? '')) ? Number(sp.ar) : Number(today().slice(0, 4));
  const o = await overview(company.id, year);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Pensionssparande</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Som enskild näringsidkare utan tjänstepension får du dra av premier för pensionsförsäkring eller IPS med högst 35 % av inkomsten av aktiv näringsverksamhet,
        och högst tio prisbasbelopp. Premien är ett privat uttag i bokföringen; avdraget görs i NE-bilagan och särskild löneskatt (24,26 %) beräknas på avdraget i deklarationen.
        Betala in före årets slut för att få avdrag för året.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Avdragsutrymme {year}</div><div className="value ep-max">{kr(o.max)}</div></div>
        <div className="card stat"><div className="label">Inbetalt</div><div className="value ep-paid">{kr(o.paid)}</div></div>
        <div className="card stat"><div className="label">Kvar att sätta in</div><div className="value ep-left">{kr(o.left)}</div></div>
        <div className="card stat"><div className="label">Särskild löneskatt på avdraget</div><div className="value ep-slp">{kr(o.slp)}</div></div>
      </div>
      <form action={saveSettings.bind(null, company.id)} className="card row">
        <input type="hidden" name="year" value={year} />
        <label>Inkomst av aktiv näringsverksamhet (kr, tomt = bokfört resultat {kr(o.bookedResult)})<input name="income" defaultValue={o.manual ? krIn(o.income) : ''} /></label>
        <label className="check"><input type="checkbox" name="has_occupational" defaultChecked={o.hasOccupational} /> Jag har tjänstepension i en anställning</label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
      </form>
      <table className="ep-list"><tbody>{o.payments.map((p) => <tr key={p.id}><td>{p.date}</td><td>{p.insurer}</td><td className="num">{kr(p.amount)}</td></tr>)}</tbody></table>
      <form action={pay.bind(null, company.id)} className="card row">
        <label>Premie (kr)<input name="amount" required /></label>
        <label>Försäkringsbolag/IPS<input name="insurer" maxLength={100} /></label>
        <label>Betalningsdag<input type="date" name="date" defaultValue={`${year}-${today().slice(5)}`} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Bokför premie</button></div>
      </form>
    </div>
  );
}
