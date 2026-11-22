import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/garnishment';
import { addDecision, applyToRun, endDecision, pay } from './actions';

export const dynamic = 'force-dynamic';

/** Löneutmätning enligt beslut från Kronofogden */
export default async function Garnishment({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const o = await overview(company.id);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Löneutmätning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">När Kronofogden har beslutat om löneutmätning ska arbetsgivaren dra det beslutade beloppet från nettolönen, men den anställde behåller alltid förbehållsbeloppet.
        Avdraget bokförs mot 2750 och betalas in till Kronofogden senast den dag som anges i beslutet. Arbetsgivaren ska följa beslutet tills Kronofogden meddelar att det upphör.</p>
      {o.unpaid > 0 && <form action={pay.bind(null, company.id)} className="card row"><span>Innehållet att betala in: <b className="ut-unpaid">{kr(o.unpaid)}</b> kr</span>
        <label>Betalningsdag<input type="date" name="date" defaultValue={today()} /></label><div style={{ flex: '0 0 auto' }}><button>Bokför inbetalning till Kronofogden</button></div></form>}
      {o.decisions.map((g) => {
        const runs = o.runs.filter((r) => !g.applied.includes(r.id));
        return (
          <section key={g.id} className="card stack ut-decision" data-name={g.name} style={{ margin: '1rem 0' }}>
            <h3 style={{ margin: 0 }}>{g.name} <span className="small muted">mål {g.case_no} · {kr(g.monthly_amount)} kr/mån · förbehållsbelopp {kr(g.reserved_amount)} kr · från {g.valid_from}{g.ended_on ? ` · upphörde ${g.ended_on}` : ''}</span></h3>
            <p className="small" style={{ margin: 0 }}>Innehållet hittills <span className="ut-withheld">{kr(g.withheld)}</span> kr.</p>
            {!g.ended_on && <div className="row">
              {runs.length > 0 && <form action={applyToRun.bind(null, company.id, g.id)} className="row" style={{ gap: '.25rem' }}>
                <select name="run_id">{runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}</select><button className="secondary">Dra på lönen</button></form>}
              <form action={endDecision.bind(null, company.id, g.id)} className="row" style={{ gap: '.25rem' }}>
                <input type="date" name="ended_on" defaultValue={today()} /><button className="secondary">Beslutet har upphört</button></form>
            </div>}
          </section>);
      })}
      {o.months.length > 0 && <><h2>Redovisning per månad</h2><table className="ut-months"><tbody>{o.months.map((m) => <tr key={m.period}><td>{m.period}</td><td className="num">{kr(m.amount)}</td><td>{m.paid ? 'Inbetald' : 'Att betala'}</td></tr>)}</tbody></table></>}
      <form action={addDecision.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Anställd<select name="employee_id" required>{o.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Målnummer<input name="case_no" required maxLength={60} /></label>
        <label>Belopp att dra per månad (kr)<input name="monthly_amount" required style={{ width: '8rem' }} /></label>
        <label>Förbehållsbelopp (kr)<input name="reserved_amount" required style={{ width: '8rem' }} /></label>
        <label>Gäller från<input type="date" name="valid_from" defaultValue={today()} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Registrera beslut</button></div>
      </form>
    </div>
  );
}
