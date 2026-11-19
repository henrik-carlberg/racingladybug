import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { prelimAdvice, taxAccountForecast } from '@/lib/services/tax-planning';
import { prelim } from './actions';

export const dynamic = 'force-dynamic';
const krIn = (ore: number) => (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');

export default async function TaxPlanning({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const b = `/c/${company.id}`;
  const [f, p] = await Promise.all([taxAccountForecast(company.id), prelimAdvice(company.id)]);
  return (
    <div style={{ maxWidth: 960 }}>
      <h1>Skatteplanering</h1>
      <p className="muted">Vad som dras från skattekontot de närmaste tre månaderna, om preliminärskatten räcker och vilka bokslutsdispositioner som sänker skatten.</p>
      <Flash searchParams={searchParams} />

      <h2>Skattekontot framåt</h2>
      {f.shortfall
        ? <div className="flash error tax-shortfall">Saldot räcker inte: sätt in minst {kr(f.shortfall.amount)} kr på skattekontot senast {f.shortfall.date} för att undvika kostnadsränta.</div>
        : <div className="flash ok">Saldot räcker för allt som förfaller de närmaste tre månaderna.</div>}
      <div className="table-wrap"><table className="tax-forecast">
        <thead><tr><th>Förfaller</th><th>Vad</th><th className="num">Belopp</th><th className="num">Saldo efter</th></tr></thead>
        <tbody>
          <tr><td>Nu</td><td>Saldo enligt bokföringen (konto 1630)</td><td></td><td className="num">{kr(f.balance)}</td></tr>
          {f.rows.map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.text}</td><td className="num">{kr(r.amount)}</td>
            <td className="num" style={r.balance < 0 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{kr(r.balance)}</td></tr>)}
          {f.rows.length === 0 && <tr><td colSpan={4} className="muted">Inget förfaller de närmaste tre månaderna.</td></tr>}
        </tbody>
      </table></div>
      <p className="small muted">Momsen räknas från bokföringen för perioden, arbetsgivaravgifter och avdragen skatt från bokförda löner. Stäm av saldot mot Skatteverket under <Link href={`${b}/skattekonto`}>Skattekontot</Link>.</p>

      <h2>Preliminärskatt</h2>
      {p ? (
        <div className={`card stack prelim ${p.change ? 'warn' : ''}`}>
          <div className="grid">
            <div className="stat"><div className="label">Prognos skattepliktigt resultat {p.fy.start_date.slice(0, 4)}</div><div className="value">{kr(p.profit)}</div><div className="small muted">utifrån {p.months} månader hittills</div></div>
            <div className="stat"><div className="label">Beräknad skatt för året</div><div className="value">{kr(p.tax)}</div></div>
            <div className="stat"><div className="label">Inbetalt med nuvarande F-skatt</div><div className="value">{kr(p.current)}</div></div>
          </div>
          <p style={{ margin: 0 }}><b>{p.advice}</b></p>
          {p.change && <p className="small muted" style={{ margin: 0 }}>Ändra i Skatteverkets e-tjänst Preliminär inkomstdeklaration. {company.company_type === 'EF' ? 'För enskild firma är skatten en uppskattning (egenavgifter och kommunalskatt varierar).' : ''}</p>}
          <form action={prelim.bind(null, company.id)} className="row">
            <label>Debiterad preliminärskatt per månad (kr)<input name="monthly" defaultValue={krIn(f.monthly)} inputMode="decimal" /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Spara</button></div>
          </form>
        </div>
      ) : <p className="muted">Lägg upp räkenskapsåret först.</p>}

      <h2>Bokslut och moms</h2>
      <p><Link href={`${b}/bokslut/${p?.fy.id ?? ''}/dispositioner`}>Bokslutsdispositioner för {p?.fy.start_date.slice(0, 4)}</Link> – periodiseringsfond, överavskrivningar och koncernbidrag med förklaring och skatteeffekt.
        {' '}<Link href={`${b}/rapporter/moms`}>Momsdeklarationen ruta för ruta</Link> – kontroller innan du lämnar in.</p>
    </div>
  );
}
