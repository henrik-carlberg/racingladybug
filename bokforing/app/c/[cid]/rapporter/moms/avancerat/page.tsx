import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { investments, proportionPreview, runs } from '@/lib/services/vat-advanced';
import { adjust, dispose, investment, proportion, settings } from './actions';
import { KIND_LABEL } from '@/lib/vat-advanced';

export const dynamic = 'force-dynamic';

export default async function VatAdvanced({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const c = ctx.company;
  const t = today();
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = iso(sp.from) ?? `${t.slice(0, 7)}-01`, to = iso(sp.to) ?? t;
  const [p, rs, inv] = await Promise.all([proportionPreview(c.id, from, to), runs(c.id), investments(c.id)]);
  const year = Number(t.slice(0, 4));
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Moms – blandad verksamhet och jämkning</h1>
      <p className="small"><Link href={`/c/${c.id}/rapporter/moms`}>← Momsdeklarationen</Link></p>
      <Flash searchParams={searchParams} />

      <h2>Blandad verksamhet</h2>
      <p className="small muted">Har bolaget både momspliktig och momsfri försäljning får ingående moms på gemensamma kostnader (t.ex. lokalhyra, el, administration) bara dras av till den del som avser den momspliktiga verksamheten. Avdragsandelen beräknas på omsättningen och avrundas uppåt till hela procent.</p>
      <form action={settings.bind(null, c.id)} className="card row">
        <label>Avdragsandel %<input name="pct" defaultValue={p.pct != null ? String(p.pct).replace('.', ',') : ''} placeholder={`${p.suggested} (beräknad)`} inputMode="decimal" style={{ width: 110 }} /></label>
        <label style={{ flex: '2 1 240px' }}>Konton med gemensamma kostnader<input name="accounts" defaultValue={p.accounts.join(', ')} placeholder="T.ex. 5010, 5020, 6110" /></label>
        <button className="secondary">Spara</button>
        <span className="small muted" style={{ alignSelf: 'center' }}>Omsättning i år: momspliktig {kr(p.taxable)} kr, momsfri {kr(p.exempt)} kr → <b className="suggested-pct">{p.suggested} %</b></span>
      </form>
      <form method="get" className="row"><label>Från<input type="date" name="from" defaultValue={from} /></label><label>Till<input type="date" name="to" defaultValue={to} /></label><button className="secondary">Räkna</button></form>
      <div className="grid">
        <div className="card stat"><div className="label">Gemensam ingående moms</div><div className="value common-vat">{kr(p.commonVat)}</div></div>
        <div className="card stat"><div className="label">Avdragsandel</div><div className="value">{p.effective} %</div></div>
        <div className="card stat"><div className="label">Ej avdragsgill – till kostnad</div><div className="value non-deductible">{kr(p.nonDeductible)}</div></div>
      </div>
      <form action={proportion.bind(null, c.id)} className="actions"><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
        <button disabled={!p.nonDeductible}>Bokför proportionering {from} – {to}</button></form>
      {rs.length > 0 && <table className="small"><thead><tr><th>Period</th><th className="num">Andel</th><th className="num">Gemensam moms</th><th className="num">Till kostnad</th></tr></thead>
        <tbody>{rs.map((r) => <tr key={r.period_from}><td>{r.period_from} – {r.period_to}</td><td className="num">{r.pct} %</td><td className="num">{kr(r.common_vat)}</td><td className="num">{kr(r.non_deductible)}</td></tr>)}</tbody></table>}

      <h2 id="jamkning">Jämkning av investeringsvaror</h2>
      <p className="small muted">Ingående moms på fastighetsinvesteringar (minst 100 000 kr) jämkas under tio år vid förvärv och tjugo år vid ny-, till- eller ombyggnad, och på maskiner och inventarier (minst 50 000 kr exkl. moms) under fem år, om andelen momspliktig användning ändras med minst tio procentenheter. Säljs eller tas investeringen ur verksamheten under korrigeringstiden slutjämkas alla återstående år på en gång.</p>
      <form action={investment.bind(null, c.id)} className="card row">
        <label style={{ flex: '2 1 200px' }}>Investering<input name="description" required placeholder="T.ex. ombyggnad av lokalen" /></label>
        <label>Typ<select name="kind">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Färdigställd<input type="date" name="completed_on" required /></label>
        <label>Ingående moms (kr)<input name="vat_amount" inputMode="decimal" required style={{ width: 120 }} /></label>
        <label>Avdragsandel då %<input name="orig_pct" defaultValue="100" inputMode="decimal" style={{ width: 80 }} /></label>
        <button className="secondary">Registrera</button>
      </form>
      {inv.map((i) => (
        <div key={i.id} className="card investment">
          <b>{i.description}</b> <span className="small muted">{KIND_LABEL[i.kind]} · färdigställd {i.completed_on} · moms {kr(i.vat_amount)} kr · avdrag {i.orig_pct} % · korrigeringstid t.o.m. {i.lastYear}</span>
          {i.adjustments.length > 0 && <ul className="small">{i.adjustments.map((a) => <li key={a.year} className="adj-row">{a.year}: användning {a.new_pct} % → {a.amount > 0 ? 'ytterligare avdrag' : 'återbetalning'} {kr(Math.abs(a.amount))} kr</li>)}</ul>}
          {i.disposed_year ? <p className="small muted inv-disposed">Avyttrad {i.disposed_year} ({i.disposal === 'taxable' ? 'momspliktigt' : 'momsfritt'}) och slutjämkad.</p> : <>
          <form action={adjust.bind(null, c.id, i.id)} className="row"><label>År<input name="year" defaultValue={year} inputMode="numeric" style={{ width: 80 }} /></label>
            <label>Momspliktig användning i år %<input name="new_pct" inputMode="decimal" style={{ width: 90 }} required /></label><button className="secondary small">Jämka</button></form>
          <form action={dispose.bind(null, c.id, i.id)} className="row inv-dispose"><label>Avyttringsår<input name="year" defaultValue={year} inputMode="numeric" style={{ width: 80 }} /></label>
            <label>Avyttring<select name="disposal"><option value="taxable">Försäljning med moms</option><option value="exempt">Momsfri försäljning eller uttag</option></select></label><button className="secondary small">Slutjämka</button></form></>}
        </div>))}
    </div>
  );
}
