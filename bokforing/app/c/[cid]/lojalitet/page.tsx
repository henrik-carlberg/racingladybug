import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/loyalty';
import { accrueAction, collectAction, enrollAction, expireAction, redeemAction, settingsAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Loyalty({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const s = o.settings;
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Lojalitetsprogram</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Medlemmar tjänar bonuspoäng på fakturerade köp. Den del av försäljningen som motsvarar poängen redovisas som förutbetald intäkt (2970) tills poängen löses in eller förfaller:
        skulden är poängens värde gånger förväntad inlösen och justeras mot 3790. Inlösen blir en rabatt på ett kreditfakturautkast, som minskar intäkt och moms.</p>
      {s && <>
        <div className="row">
          <div className="card stat"><div className="label">Utestående poäng</div><div className="value ly-points">{o.outstanding.toLocaleString('sv-SE')}</div></div>
          <div className="card stat"><div className="label">Skuld enligt programmet</div><div className="value ly-target">{kr(o.target)}</div></div>
          <div className="card stat"><div className="label">Bokförd skuld 2970</div><div className="value ly-booked">{kr(o.booked)}</div></div>
        </div>
        <div className="row">
          <form action={collectAction.bind(null, id)}><button>Registrera poäng från fakturor{o.pending ? ` (${o.pending})` : ''}</button></form>
          <form action={expireAction.bind(null, id)}><input type="hidden" name="date" value={t} /><button className="secondary">Låt gamla poäng förfalla</button></form>
          <form action={accrueAction.bind(null, id)}><input type="hidden" name="date" value={t} /><button className="secondary">Justera skulden</button></form>
        </div>
        <table className="ly-members"><thead><tr><th>Medlem</th><th>Sedan</th><th className="num">Intjänat</th><th className="num">Inlöst</th><th className="num">Förfallet</th><th className="num">Saldo</th><th className="num">Förfaller nu</th></tr></thead>
          <tbody>{o.members.map((m) => <tr key={m.customer_id} className="ly-row" data-name={m.name}><td>{m.name}</td><td>{m.joined_on}</td><td className="num">{m.earned}</td><td className="num">{m.redeemed}</td><td className="num">{m.expired}</td><td className="num ly-balance">{m.balance}</td><td className="num">{m.expiring || ''}</td></tr>)}
            {!o.members.length && <tr><td colSpan={7} className="muted">Inga medlemmar ännu.</td></tr>}</tbody></table>
        {o.members.length > 0 && <form action={redeemAction.bind(null, id)} className="row">
          <label>Medlem<select name="customer_id">{o.members.map((m) => <option key={m.customer_id} value={m.customer_id}>{m.name} ({m.balance} p)</option>)}</select></label>
          <label>Poäng<input name="points" inputMode="numeric" required style={{ width: '6rem' }} /></label>
          <label>Datum<input type="date" name="date" defaultValue={t} /></label>
          <button>Lös in poäng</button>
        </form>}
        {o.customers.length > 0 && <form action={enrollAction.bind(null, id)} className="row">
          <label>Ny medlem<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Medlem sedan<input type="date" name="joined_on" defaultValue={t} /></label>
          <button className="secondary">Lägg till medlem</button>
        </form>}
      </>}
      <h2>Programmet</h2>
      <form action={settingsAction.bind(null, id)} className="card row">
        <label>Kronor per poäng (exkl. moms)<input name="kr_per_point" defaultValue={s ? String(s.kr_per_point).replace('.', ',') : '10'} inputMode="decimal" style={{ width: '6rem' }} /></label>
        <label>Poängens värde (kr)<input name="point_value" defaultValue={s ? String(s.point_value / 100).replace('.', ',') : '0,10'} inputMode="decimal" style={{ width: '6rem' }} /></label>
        <label>Förväntad inlösen %<input name="redemption_rate" defaultValue={s?.redemption_rate ?? 80} inputMode="numeric" style={{ width: '5rem' }} /></label>
        <label>Giltighet (månader)<input name="expiry_months" defaultValue={s?.expiry_months ?? 24} inputMode="numeric" style={{ width: '5rem' }} /></label>
        <label>Startdatum<input type="date" name="start_date" defaultValue={s?.start_date ?? t} /></label>
        <button>{s ? 'Spara' : 'Starta programmet'}</button>
      </form>
    </div>
  );
}
