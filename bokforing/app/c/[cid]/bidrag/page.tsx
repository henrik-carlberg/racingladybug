import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { RISK_LABEL } from '@/lib/grants';
import { list } from '@/lib/services/company-grants';
import { create, receive, recognize, repay, risk } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { active: 'Aktivt', repayable: 'Ska återbetalas', repaid: 'Avslutat' };

export default async function Grants({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const c = ctx.company;
  const t = today();
  const gs = await list(c.id, t);
  const projects = await sql<{ id: number; name: string }[]>`SELECT id, name FROM projects WHERE company_id = ${c.id} AND NOT EXISTS (SELECT 1 FROM company_grants g WHERE g.project_id = projects.id) ORDER BY name`;
  const pending = gs.filter((g) => g.status === 'active' && g.earned !== g.recognized).length;
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Bidrag</h1>
      <p className="muted">Offentliga bidrag (t.ex. från Tillväxtverket, Vinnova eller regionen) intäktsförs i samma takt som kostnaderna de ska täcka. Kostnaderna hämtas från projektet bidraget är kopplat till. Utbetalt före kostnaderna blir förutbetalt bidrag (2975), intjänat men inte utbetalt blir en fordran (1791). Är återbetalning sannolik förs intäkten tillbaka och det utbetalda blir skuld (2976).</p>
      <Flash searchParams={searchParams} />

      {gs.length > 0 && <form action={recognize.bind(null, c.id)} className="card row">
        <label>Per datum<input type="date" name="date" defaultValue={t} /></label>
        <button disabled={!pending}>Intäktsför bidragen</button>
        <span className="small muted" style={{ alignSelf: 'center' }}>{pending ? `${pending} bidrag har nya kostnader att matcha` : 'Allt är intäktsfört i takt med kostnaderna'}</span>
      </form>}

      {gs.map((g) => (
        <div key={g.id} className="card stack grant">
          <div className="row"><b>{g.name}</b><span className="small">{g.grantor}{g.reference && ` · dnr ${g.reference}`} · projekt {g.project} · {g.period_from} – {g.period_to} · {g.coverage_pct.toLocaleString('sv-SE')} % av kostnaderna, högst {kr(g.amount)} kr</span>
            <span className="badge">{STATUS[g.status]}</span><Link className="small" href={`/c/${c.id}/bidrag/${g.id}`}>Rapport till bidragsgivaren</Link></div>
          <div className="grid">
            <div className="stat"><div className="label">Stödberättigande kostnader</div><div className="value g-costs">{kr(g.costs)}</div></div>
            <div className="stat"><div className="label">Intjänat</div><div className="value g-earned">{kr(g.earned)}</div></div>
            <div className="stat"><div className="label">Intäktsfört (3980)</div><div className="value g-recognized">{kr(g.recognized)}</div></div>
            <div className="stat"><div className="label">Utbetalt</div><div className="value g-received">{kr(g.received)}</div></div>
            <div className="stat"><div className="label">{g.accrued ? 'Upplupet (1791)' : 'Förutbetalt (2975)'}</div><div className="value g-balance">{kr(g.accrued || g.prepaid)}</div></div>
          </div>
          {g.conditions && <p className="small">Villkor: {g.conditions}</p>}
          {g.status === 'active' && <div className="row">
            <form action={receive.bind(null, c.id, g.id)} className="row"><label>Utbetalt (kr)<input name="amount" inputMode="decimal" required style={{ width: 110 }} /></label><label>Datum<input type="date" name="date" defaultValue={t} /></label><button className="secondary">Registrera utbetalning</button></form>
            <form action={risk.bind(null, c.id, g.id)} className="row"><label>Återbetalningsrisk<select name="risk" defaultValue={g.risk}>{Object.entries(RISK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>Motivering<input name="risk_note" defaultValue={g.risk_note} /></label><button className="secondary">Spara bedömning</button></form>
          </div>}
          {g.risk === 'possible' && <p className="small" style={{ color: 'var(--warn)' }}>Eventualförpliktelse: bidraget kan behöva återbetalas ({g.risk_note || 'se villkoren'}) – upplys om det i årsredovisningen.</p>}
          {g.status === 'repayable' && <form action={repay.bind(null, c.id, g.id)} className="row"><span className="small">Skuld till {g.grantor}: {kr(g.received - g.repaid)} kr ({g.risk_note})</span><input type="date" name="date" aria-label="Datum" defaultValue={t} /><button className="secondary">Betala tillbaka</button></form>}
        </div>))}

      <h2>Nytt bidrag</h2>
      {projects.length === 0 ? <p className="small">Lägg först upp ett projekt under <Link href={`/c/${c.id}/uppdrag`}>Uppdrag</Link> – kostnaderna som bidraget ska täcka bokförs på projektet.</p> : (
        <form action={create.bind(null, c.id)} className="card stack">
          <div className="row"><label>Namn<input name="name" required /></label><label>Bidragsgivare<input name="grantor" required /></label><label>Diarienummer<input name="reference" /></label>
            <label>Projekt<select name="project_id" required>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
          <div className="row"><label>Beviljat belopp (kr)<input name="amount" inputMode="decimal" required /></label><label>Täckningsgrad %<input name="coverage_pct" defaultValue="50" inputMode="decimal" style={{ width: 70 }} /></label>
            <label>Budget stödberättigande kostnader (kr)<input name="budget" inputMode="decimal" /></label>
            <label>Från<input type="date" name="period_from" required /></label><label>Till<input type="date" name="period_to" required /></label></div>
          <label>Villkor för bidraget<input name="conditions" placeholder="T.ex. projektet ska slutföras och slutrapport lämnas senast …" /></label>
          <div><button className="secondary">Registrera bidrag</button></div>
        </form>)}
    </div>
  );
}
