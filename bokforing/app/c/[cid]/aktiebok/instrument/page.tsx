import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/share-instruments';
import { accrueAction, closeAction, convertAction, issueAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { active: 'Utestående', converted: 'Konverterad', exercised: 'Utnyttjad', repaid: 'Återbetald', expired: 'Förfallen' };

export default async function Instruments({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Konvertibler och teckningsoptioner</h1>
      <p className="small"><Link href={`/c/${id}/aktiebok`}>← Aktiebok</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Ett konvertibelt lån bokförs som skuld (2320) och räntan periodiseras (8410/2960). Premien för teckningsoptioner tillförs fritt eget kapital (2097).
        Vid konvertering eller teckning förs de nya aktierna in i aktieboken: kvotvärdet blir aktiekapital (2081) och resten överkurs (2097). Kvotvärde i dag: {kr(o.quota)} kr per aktie.</p>
      {!o.settings && <p className="muted">Lägg upp aktieboken först.</p>}
      <table className="si-list"><thead><tr><th>Innehavare</th><th>Instrument</th><th className="num">Belopp</th><th className="num">Aktier</th><th className="num">Kurs</th><th>Löptid</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.instruments.map((i) => (
          <tr key={i.id} className="si-row" data-holder={i.holder_name} data-kind={i.kind}><td>{i.holder_name}</td><td>{i.kind === 'convertible' ? `Konvertibel ${i.interest_pct.toLocaleString('sv-SE')} %` : 'Teckningsoptioner'}</td>
            <td className="num">{kr(i.amount)}</td><td className="num">{i.shares}</td><td className="num">{kr(i.strike)}</td><td className="small">{i.issued_on}–{i.expires_on}</td>
            <td className="small">{STATUS[i.status]}{i.closed_on && ` ${i.closed_on}`}{i.kind === 'convertible' && <div>Upplupen ränta bokförd {kr(i.interest_booked)} kr</div>}</td>
            <td>{i.status === 'active' && <div className="stack" style={{ gap: '.25rem' }}>
              {i.pendingInterest > 0 && <form action={accrueAction.bind(null, id, i.id)}><input type="hidden" name="date" value={t} /><button className="link">Periodisera ränta ({kr(i.pendingInterest)} kr)</button></form>}
              <form action={convertAction.bind(null, id, i.id)}><input type="hidden" name="date" value={t} /><button className="link">{i.kind === 'convertible' ? 'Konvertera till aktier' : 'Teckna aktier'}</button></form>
              <form action={closeAction.bind(null, id, i.id)}><input type="hidden" name="date" value={t} /><button className="link">{i.kind === 'convertible' ? 'Återbetala' : 'Låt förfalla'}</button></form></div>}</td></tr>))}
          {!o.instruments.length && <tr><td colSpan={8} className="muted">Inga konvertibler eller optioner.</td></tr>}</tbody></table>
      <h2>Utspädning</h2>
      <table className="si-dilution"><thead><tr><th>Ägare</th><th className="num">Aktier</th><th className="num">Andel i dag</th><th className="num">Efter full utspädning</th></tr></thead>
        <tbody>{o.dilution.map((d) => <tr key={d.name} data-name={d.name}><td>{d.name}</td><td className="num">{d.shares}</td><td className="num">{d.pct.toLocaleString('sv-SE')} %</td><td className="num si-diluted">{d.diluted.toLocaleString('sv-SE')} %</td></tr>)}</tbody></table>
      {o.settings && <><h2>Ge ut</h2>
        <form action={issueAction.bind(null, id)} className="card row">
          <label>Instrument<select name="kind"><option value="convertible">Konvertibelt lån</option><option value="warrant">Teckningsoptioner</option></select></label>
          <label>Innehavare<input name="holder_name" required /></label>
          <label>Person-/orgnr<input name="holder_id" /></label>
          <label>Lånebelopp / premie (kr)<input name="amount" inputMode="decimal" style={{ width: '8rem' }} /></label>
          <label>Kurs per aktie (kr)<input name="strike" inputMode="decimal" required style={{ width: '7rem' }} /></label>
          <label>Aktier (optioner)<input name="shares" inputMode="numeric" style={{ width: '5rem' }} /></label>
          <label>Ränta % (konvertibel)<input name="interest_pct" inputMode="decimal" style={{ width: '5rem' }} /></label>
          <label>Utgiven<input type="date" name="issued_on" defaultValue={t} /></label>
          <label>Löptid till<input type="date" name="expires_on" required /></label>
          <button>Registrera</button>
        </form></>}
    </div>
  );
}
