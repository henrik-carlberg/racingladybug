import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { addMonths } from '@/lib/assets';
import { EU_COUNTRIES } from '@/lib/eu';
import { FLOW_LABEL, TRANSACTIONS, type Flow } from '@/lib/intrastat';
import { overview } from '@/lib/services/intrastat';
import { addLine, deleteLine } from './actions';

export const dynamic = 'force-dynamic';

/** Intrastat: varuhandel med andra EU-länder till SCB */
export default async function Intrastat({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const period = /^\d{4}-\d{2}$/.test(String(sp.period ?? '')) ? String(sp.period) : addMonths(today().slice(0, 7), -1);
  const o = await overview(company.id, period);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Intrastat</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Företag vars införsel eller utförsel av varor från eller till andra EU-länder överstiger SCB:s tröskelvärde (rullande tolv månader) ska lämna en Intrastatdeklaration
        varje månad, senast den tionde vardagen i månaden efter. Raderna anges per varukod (KN-nummer), partnerland och transaktionsslag med fakturerat värde och nettovikt.
        Bokföringen (konton 3106/3108 och 4515–4517) används för att bevaka tröskeln och stämma av deklarationen.</p>
      <form className="row" method="get"><label>Månad<input type="month" name="period" defaultValue={period} /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div></form>
      <div className="grid">
        {(['arrival', 'dispatch'] as Flow[]).map((f) => { const x = o[f]; return (
          <div key={f} className={`card stat is-${f}`}>
            <div className="label">{FLOW_LABEL[f]} senaste tolv månaderna</div><div className="value">{kr(x.rolling)}</div>
            <div className={`small is-status${x.required ? ' danger' : ''}`} style={x.required ? { color: 'var(--danger)' } : x.warning ? { color: 'var(--warn)' } : {}}>
              {x.required ? `Rapporteringsplikt: över tröskeln ${kr(x.threshold)} kr` : x.warning ? `Nära tröskeln ${kr(x.threshold)} kr` : `Under tröskeln ${kr(x.threshold)} kr`}</div>
            <div className="small">Månaden enligt bokföringen {kr(x.ledger)} kr, deklarerat <span className="is-declared">{kr(x.declared)}</span> kr{x.ledger || x.declared ? ` (${x.deviation > 0 ? '+' : ''}${x.deviation} %)` : ''}</div>
          </div>); })}
      </div>
      <table className="is-lines"><thead><tr><th>Flöde</th><th>Varukod</th><th>Land</th><th>Ursprung</th><th>Transaktion</th><th className="num">Värde</th><th className="num">Vikt kg</th><th /></tr></thead>
        <tbody>{o.lines.map((l) => <tr key={l.id} className="is-line"><td>{FLOW_LABEL[l.flow]}</td><td>{l.kn}</td><td>{l.country}</td><td>{l.origin}</td><td>{l.txn}</td><td className="num">{kr(l.value)}</td><td className="num">{l.mass}</td>
          <td><form action={deleteLine.bind(null, company.id, period, l.id)}><button className="link">Ta bort</button></form></td></tr>)}</tbody></table>
      {o.lines.length > 0 && <p><a href={`${b}/intrastat/fil?period=${period}`} className="button secondary">Hämta fil för {period}</a></p>}
      <form action={addLine.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <input type="hidden" name="period" value={period} />
        <label>Flöde<select name="flow"><option value="dispatch">Utförsel</option><option value="arrival">Införsel</option></select></label>
        <label>Varukod (KN)<input name="kn" required style={{ width: '7rem' }} /></label>
        <label>Partnerland<select name="country">{EU_COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Ursprungsland<input name="origin" maxLength={2} style={{ width: '4rem' }} placeholder="DE" /></label>
        <label>Transaktion<select name="txn">{Object.entries(TRANSACTIONS).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}</select></label>
        <label>Fakturerat värde (kr)<input name="value" required style={{ width: '8rem' }} /></label>
        <label>Nettovikt (kg)<input name="mass" required style={{ width: '6rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Lägg till rad</button></div>
      </form>
    </div>
  );
}
