import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { fiscalYears } from '@/lib/server/ledger';
import { FULFILMENT_PCT, FULFILMENT_YEARS } from '@/lib/coop';
import * as s from '@/lib/services/coop';
import { form, grant, insats, member, notice, payGrant, payRefund, refund, settings } from './actions';

export const dynamic = 'force-dynamic';

export default async function Coop({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const c = ctx.company;
  const o = await s.overview(c.id);
  const owner = ctx.role === 'owner';
  const other = o.form && o.form !== 'ek' && o.form !== 'stiftelse';
  const fys = await fiscalYears(c.id);
  const fyId = Number(sp.fy) || fys.find((f) => f.end_date < today())?.id || fys[0]?.id;
  const t = today();
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Ekonomisk förening och stiftelse</h1>
      <p className="muted">Ekonomisk förening: medlemsinsatser på 2083, utträde med återbetalning av insatsen och återbäring efter medlemmarnas köp. Stiftelse: ändamål, beviljade bidrag och fullföljdskravet.</p>
      <Flash searchParams={searchParams} />

      {owner && (other
        ? <p className="card small">Bolaget har läget för {o.form === 'brf' ? 'bostadsrättsförening' : 'ideell förening'} påslaget. Stäng av det först.</p>
        : <form action={form.bind(null, c.id)} className="card row">
          <label>Organisationsform<select name="form" defaultValue={o.form ?? ''}><option value="">Ingen av dessa</option><option value="ek">Ekonomisk förening</option><option value="stiftelse">Stiftelse</option></select></label>
          <button className="secondary">Spara</button>
        </form>)}

      {o.form === 'ek' && <Ek cid={c.id} fyId={fyId} fys={fys} insatsDefault={o.settings.insats} owner={owner} t={t} />}
      {o.form === 'stiftelse' && <Foundation cid={c.id} purpose={o.settings.purpose} owner={owner} t={t} />}
    </div>
  );
}

async function Ek({ cid, fyId, fys, insatsDefault, owner, t }: { cid: number; fyId?: number; fys: { id: number; start_date: string; end_date: string }[]; insatsDefault: number; owner: boolean; t: string }) {
  const ms = await s.members(cid);
  const rs = await s.refunds(cid);
  const basis = fyId ? await s.refundBasis(cid, fyId) : null;
  const total = ms.reduce((a, m) => a + m.insats, 0);
  return (<>
    {owner && <form action={settings.bind(null, cid)} className="card row"><label>Insats per medlem enligt stadgarna (kr)<input name="insats" defaultValue={insatsDefault ? String(insatsDefault / 100) : ''} inputMode="decimal" /></label><button className="secondary">Spara</button></form>}

    <h2>Medlemmar och insatser</h2>
    <div className="table-wrap"><table className="coop-members">
      <thead><tr><th>Nr</th><th>Medlem</th><th>Inträde</th><th className="num">Inbetald insats</th><th>Status</th><th></th></tr></thead>
      <tbody>{ms.map((m) => (
        <tr key={m.id} className="coop-member">
          <td>{m.member_no}</td><td><b>{m.name}</b><div className="small muted">{m.email}</div></td><td>{m.joined}</td><td className="num insats">{kr(m.insats)}</td>
          <td className="status small">{m.left_on ? <>Uppsagd {m.notice_on}, avgår {m.left_on}<br />Återbetalning från {m.payable_from}</> : 'Medlem'}</td>
          <td>
            {!m.left_on && <form action={insats.bind(null, cid, m.id)} className="row"><input type="hidden" name="kind" value="paid" />
              <input name="amount" aria-label="Insats" defaultValue={insatsDefault ? String((insatsDefault - m.insats > 0 ? insatsDefault - m.insats : insatsDefault) / 100) : ''} inputMode="decimal" style={{ width: 90 }} />
              <input type="date" name="date" aria-label="Datum" defaultValue={t} /><button className="secondary small">Insats betald</button></form>}
            {!m.left_on && <form action={notice.bind(null, cid, m.id)} className="row"><input type="date" name="notice_on" aria-label="Uppsägning" defaultValue={t} /><button className="secondary small">Uppsägning</button></form>}
            {m.left_on && m.insats > 0 && <form action={insats.bind(null, cid, m.id)} className="row"><input type="hidden" name="kind" value="repaid" />
              <input type="date" name="date" aria-label="Datum" defaultValue={m.payable_from && m.payable_from > t ? m.payable_from : t} /><button className="secondary small">Betala tillbaka insatsen</button></form>}
          </td>
        </tr>))}</tbody>
      <tfoot><tr><td colSpan={3}>Summa medlemsinsatser (2083)</td><td className="num total-insats">{kr(total)}</td><td colSpan={2}></td></tr></tfoot>
    </table></div>
    <form action={member.bind(null, cid)} className="card row">
      <label>Namn<input name="name" required /></label><label>E-post<input name="email" type="email" /></label><label>Inträde<input type="date" name="joined" defaultValue={t} /></label>
      <button className="secondary">Ny medlem</button>
    </form>

    <h2>Återbäring</h2>
    <p className="small muted">Föreningsstämman beslutar om återbäring i förhållande till medlemmarnas köp. Den bokas som minskad omsättning (3739) mot skuld till medlemmarna (2891) per räkenskapsårets sista dag och är avdragsgill för föreningen.</p>
    {basis && <>
      <form method="get" className="row"><label>Räkenskapsår<select name="fy" defaultValue={String(fyId)}>{fys.map((f) => <option key={f.id} value={f.id}>{f.start_date} – {f.end_date}</option>)}</select></label><button className="secondary">Visa</button></form>
      <table className="refund-basis"><thead><tr><th>Medlem</th><th className="num">Köp under året</th></tr></thead>
        <tbody>{basis.rows.map((r) => <tr key={r.member_id}><td>{r.name}</td><td className="num">{kr(r.base)}</td></tr>)}</tbody></table>
      {!rs.some((r) => r.year === basis.fy.start_date.slice(0, 4)) && <form action={refund.bind(null, cid)} className="card row"><input type="hidden" name="fy" value={fyId} />
        <label>Återbäring totalt (kr)<input name="total" inputMode="decimal" required /></label><label>Stämmans beslut<input type="date" name="decided_on" defaultValue={t} /></label>
        <button>Besluta och bokför återbäring</button></form>}
    </>}
    {rs.map((r) => (
      <div key={r.id} className="card refund">
        <b>Återbäring {r.year}: {kr(r.total)} kr</b> <span className="small muted">beslutad {r.decided_on}</span>
        <ul className="small">{r.lines.map((l, i) => <li key={i} className="refund-line">{l.name}: {kr(l.amount)} kr (köp {kr(l.base)})</li>)}</ul>
        {r.paid ? <span className="small">Utbetald</span> : <form action={payRefund.bind(null, cid, r.id)} className="row"><input type="date" name="date" aria-label="Datum" defaultValue={t} /><button className="secondary small">Betala ut</button></form>}
      </div>))}
  </>);
}

async function Foundation({ cid, purpose, owner, t }: { cid: number; purpose: string; owner: boolean; t: string }) {
  const gs = await s.grants(cid);
  const ff = await s.fulfilmentReport(cid);
  return (<>
    <h2>Ändamål</h2>
    {owner ? <form action={settings.bind(null, cid)} className="card stack"><textarea name="purpose" rows={3} defaultValue={purpose} aria-label="Ändamål" placeholder="Stiftelsens ändamål enligt stiftelseförordnandet" /><button className="secondary">Spara</button></form>
      : <p>{purpose || '–'}</p>}

    <h2>Fullföljdskravet</h2>
    <p className="small muted">En skattebefriad stiftelse ska under en period av {FULFILMENT_YEARS} år använda ungefär {FULFILMENT_PCT} % av avkastningen till ändamålet. Avkastning = intäkter och finansiella intäkter minus förvaltningskostnader; ändamålskostnader bokförs på 6993.</p>
    <div className="table-wrap"><table className="fulfilment">
      <thead><tr><th>År</th><th className="num">Avkastning</th><th className="num">Till ändamålet</th><th className="num">Avkastning {FULFILMENT_YEARS} år</th><th className="num">Krav {FULFILMENT_PCT} %</th><th className="num">Använt</th><th>Status</th></tr></thead>
      <tbody>{ff.map((y) => (
        <tr key={y.year} className="ff-row"><td>{y.label}</td><td className="num">{kr(y.yield)}</td><td className="num">{kr(y.purpose)}</td><td className="num">{kr(y.windowYield)}</td><td className="num">{kr(y.required)}</td>
          <td className="num">{y.pct == null ? '–' : `${y.pct.toLocaleString('sv-SE')} %`}</td>
          <td className="ff-status">{y.shortfall > 0 ? <span style={{ color: 'var(--warn)' }}>⚠ {kr(y.shortfall)} kr kvar att dela ut</span> : '✓ uppfyllt'}</td></tr>))}</tbody>
    </table></div>

    <h2>Beviljade bidrag</h2>
    <form action={grant.bind(null, cid)} className="card row">
      <label>Mottagare<input name="recipient" required /></label><label>Ändamål<input name="purpose" /></label><label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label>
      <label>Beslut<input type="date" name="decided_on" defaultValue={t} /></label><button className="secondary">Bevilja</button>
    </form>
    <table className="grants"><thead><tr><th>Beslut</th><th>Mottagare</th><th>Ändamål</th><th className="num">Belopp</th><th></th></tr></thead>
      <tbody>{gs.map((g) => (
        <tr key={g.id} className="grant-row"><td>{g.decided_on}</td><td>{g.recipient}</td><td>{g.purpose}</td><td className="num">{kr(g.amount)}</td>
          <td>{g.paid_on ? <span className="small">Utbetalt {g.paid_on}</span> : <form action={payGrant.bind(null, cid, g.id)} className="row"><input type="date" name="date" aria-label="Datum" defaultValue={t} /><button className="secondary small">Betala ut</button></form>}</td></tr>))}</tbody>
    </table>
  </>);
}
