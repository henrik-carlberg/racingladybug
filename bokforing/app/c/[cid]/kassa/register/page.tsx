import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { WEEKDAYS } from '@/lib/cash-register';
import { overview } from '@/lib/services/cash-register';
import { addRegister, addXReport, deactivate } from './actions';

export const dynamic = 'force-dynamic';

/** Kassaregister, kontrollenheter och dagsrapporter */
export default async function Registers({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const o = await overview(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <p><Link href={`${b}/kassa`}>← Kassa och e-handel</Link></p>
      <h1>Kassaregister och kontrollenheter</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Den som säljer mot kontanter eller kort ska normalt ha ett certifierat kassaregister med en kontrollenhet som är anmäld till Skatteverket (kassaregisterplikt),
        om försäljningen överstiger fyra prisbasbelopp per år. Varje dag tas en Z-rapport (dagsavslut) som bokförs i dagskassan; X-rapporter under dagen sparas som underlag.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Kassaförsäljning i år</div><div className="value kr-sales">{kr(o.sales)}</div>
          <div className={`small kr-obliged`} style={o.obliged && !o.registers.length ? { color: 'var(--danger)' } : {}}>
            {o.obliged ? `Över fyra prisbasbelopp (${kr(o.limit)} kr): kassaregisterplikt${o.registers.length ? '' : ' – anmäl kassaregister och kontrollenhet'}` : `Under fyra prisbasbelopp (${kr(o.limit)} kr)`}</div></div>
      </div>
      {o.unregistered.length > 0 && <div className="card kr-unregistered" style={{ borderColor: 'var(--warn)' }}>⚠️ Dagskassan har bokförts för kassor utan anmäld kontrollenhet: {o.unregistered.join(', ')}.</div>}
      {o.registers.map((r) => (
        <section key={r.id} className="card stack kr-register" data-name={r.name} style={{ margin: '1rem 0' }}>
          <h3 style={{ margin: 0 }}>{r.name} {!r.active && <span className="badge">Avregistrerad</span>}<span className="small muted"> · kontrollenhet {r.control_unit} · anmäld {r.registered_on}{r.skv_reference ? ` · ${r.skv_reference}` : ''} · öppet {r.open_days.map((d) => WEEKDAYS[d - 1].slice(0, 3)).join(', ')}</span></h3>
          {r.missing.length > 0 ? <p className="small kr-missing" style={{ color: 'var(--warn)', margin: 0 }}>Z-rapport saknas för {r.missing.length} öppetdag(ar): {r.missing.slice(0, 10).join(', ')}{r.missing.length > 10 ? ' …' : ''}</p>
            : r.active && <p className="small muted kr-ok" style={{ margin: 0 }}>Z-rapport finns för alla öppetdagar.</p>}
          {r.active && <form action={deactivate.bind(null, company.id, r.id)}><button className="link">Avregistrera kassan</button></form>}
        </section>
      ))}
      <form action={addRegister.bind(null, company.id)} className="card stack">
        <h3 style={{ margin: 0 }}>Anmäl kassaregister</h3>
        <div className="row">
          <label>Kassans namn (som i dagskassan)<input name="name" required defaultValue="Kassa 1" maxLength={60} /></label>
          <label>Kontrollenhetens tillverkningsnummer<input name="control_unit" required maxLength={40} /></label>
          <label>Anmäld till Skatteverket<input type="date" name="registered_on" defaultValue={today()} /></label>
          <label>Skatteverkets referens<input name="skv_reference" maxLength={60} /></label>
        </div>
        <div className="row">{WEEKDAYS.map((d, i) => <label key={d} className="check"><input type="checkbox" name={`day_${i + 1}`} defaultChecked={i < 6} /> {d}</label>)}</div>
        <div><button>Registrera kassaregister</button></div>
      </form>
      <h2>X-rapporter</h2>
      <form action={addXReport.bind(null, company.id)} className="card row">
        <label>Kassa<input name="register" defaultValue={o.registers[0]?.name ?? 'Kassa 1'} /></label>
        <label>Försäljning hittills i dag (kr)<input name="amount" required /></label>
        <label>Notering<input name="note" maxLength={200} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara X-rapport</button></div>
      </form>
      {o.xReports.length > 0 && <table className="small kr-x"><tbody>{o.xReports.map((x) => <tr key={x.id}><td>{x.taken_at}</td><td>{x.register}</td><td className="num">{kr(x.amount)}</td><td>{x.note}</td></tr>)}</tbody></table>}
    </div>
  );
}
