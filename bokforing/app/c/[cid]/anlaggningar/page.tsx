import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { ASSET_CATEGORIES, addMonths, periodOf } from '@/lib/assets';
import { bookValue, listAssets, planned, unregisteredAcquisitions } from '@/lib/services/assets';
import { listCostCenters } from '@/lib/services/dimensions';
import { create, depreciate, dispose, remove } from './actions';

export const dynamic = 'force-dynamic';

const CAT_BY_ACCOUNT: Record<number, string> = Object.fromEntries(Object.entries(ASSET_CATEGORIES).map(([k, c]) => [c.asset, k]));

export default async function Assets({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const t = today();
  const prevMonth = addMonths(periodOf(t), -1);
  const [assets, todo, ccs] = await Promise.all([listAssets(company.id), unregisteredAcquisitions(company.id), listCostCenters(company.id, true)]);
  const active = assets.filter((a) => a.status === 'active');
  const remaining = active.reduce((s, a) => s + Math.max(0, planned(a, prevMonth) - Number(a.booked)), 0);
  const p = (k: string) => (typeof sp[k] === 'string' ? String(sp[k]) : undefined);
  const preCat = p('account') ? CAT_BY_ACCOUNT[Number(p('account'))] : undefined;
  const b = `/c/${company.id}`;
  const sum = (f: (a: (typeof assets)[number]) => number) => active.reduce((s, a) => s + f(a), 0);
  return (
    <div>
      <h1>Anläggningsregister</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Inventarier, datorer, bilar och andra anläggningstillgångar skrivs av linjärt per månad enligt plan. Anskaffningen bokförs som vanligt, t.ex. via leverantörsfakturan på konto 1220 eller 1250, och läggs sedan upp här.
        Inventarier med kort livslängd (under tre år) eller lågt värde (under ett halvt prisbasbelopp) får dras av direkt som förbrukningsinventarier.</p>

      <div className="card row" style={{ alignItems: 'end' }}>
        <form action={depreciate.bind(null, company.id)} className="row" style={{ alignItems: 'end', flex: '1 1 auto' }}>
          <label style={{ flex: '0 0 180px' }}>Bokför avskrivningar till och med<input type="month" name="period" defaultValue={prevMonth} required /></label>
          <div style={{ flex: '0 0 auto' }}><button>Bokför avskrivningar</button></div>
          <span className="small muted">{remaining ? `${kr(remaining)} kr återstår att bokföra till och med ${prevMonth}` : `Allt är avskrivet till och med ${prevMonth}`}</span>
        </form>
      </div>

      <h2>Anläggningsförteckning</h2>
      <div className="table-wrap"><table className="small">
        <thead><tr><th>Tillgång</th><th>Kategori</th><th>Anskaffad</th><th className="num">Anskaffningsvärde</th><th className="num">Avskrivningstid</th><th className="num">Ack. avskrivning</th><th className="num">Bokfört värde</th><th>Avskrivet t.o.m.</th><th></th></tr></thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} style={a.status === 'disposed' ? { opacity: 0.6 } : undefined}>
              <td><b>{a.name}</b>{a.status === 'disposed' && <div className="badge">Avyttrad {a.disposed_on}</div>}{a.source_voucher_id && <div><Link href={`${b}/verifikationer/${a.source_voucher_id}`}>anskaffning</Link></div>}</td>
              <td>{ASSET_CATEGORIES[a.category].label}<div className="muted">{a.asset_account}</div></td>
              <td>{a.acquired_on}</td><td className="num">{kr(a.cost)}</td><td className="num">{a.life_months} mån</td>
              <td className="num">{kr(a.booked)}</td><td className="num"><b>{kr(a.status === 'disposed' ? 0 : bookValue(a))}</b></td><td>{a.last_period ?? '–'}</td>
              <td>{a.status === 'active' && (
                <details><summary>Avyttra</summary>
                  <form action={dispose.bind(null, company.id, a.id)} className="stack" style={{ minWidth: 260 }}>
                    <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
                    <label>Försäljningspris exkl. moms (0 = utrangering)<input name="price" inputMode="decimal" defaultValue="0" /></label>
                    <label>Moms<select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="0">0 %</option></select></label>
                    <button className="secondary">Bokför avyttring</button>
                    <p className="muted" style={{ margin: 0 }}>Skriv av till och med månaden före först.</p>
                  </form>
                  {Number(a.booked) === 0 && <form action={remove.bind(null, company.id, a.id)}><button className="link">Ta bort (felregistrerad)</button></form>}
                </details>
              )}</td>
            </tr>
          ))}
          {assets.length === 0 && <tr><td colSpan={9} className="muted">Inga tillgångar ännu.</td></tr>}
          {active.length > 0 && <tr className="sum"><td colSpan={3}>Summa aktiva</td><td className="num">{kr(sum((a) => Number(a.cost)))}</td><td></td><td className="num">{kr(sum((a) => Number(a.booked)))}</td><td className="num">{kr(sum(bookValue))}</td><td colSpan={2}></td></tr>}
        </tbody>
      </table></div>

      {todo.length > 0 && (
        <>
          <h2>Anskaffningar att lägga upp</h2>
          <p className="small muted">Bokförda belopp på anläggningskonton som inte finns i registret.</p>
          <table className="small"><tbody>{todo.map((x) => (
            <tr key={`${x.voucher_id}-${x.account}`}><td><Link href={`${b}/verifikationer/${x.voucher_id}`}>{x.label}</Link></td><td>{x.date}</td><td>{x.account}</td><td>{x.description}</td><td className="num">{kr(x.amount)}</td>
              <td><Link href={`${b}/anlaggningar?voucher=${x.voucher_id}&account=${x.account}&amount=${(x.amount / 100).toFixed(2).replace('.', ',')}&date=${x.date}&name=${encodeURIComponent(x.description)}#ny`}>Lägg upp</Link></td></tr>
          ))}</tbody></table>
        </>
      )}

      <h2 id="ny">Ny tillgång</h2>
      <form action={create.bind(null, company.id)} className="card stack">
        <input type="hidden" name="source_voucher_id" value={p('voucher') ?? ''} />
        <div className="row">
          <label style={{ flex: '2 1 240px' }}>Benämning<input name="name" required defaultValue={p('name')} placeholder="T.ex. Bärbar dator, Lenovo" /></label>
          <label>Kategori<select name="category" defaultValue={preCat ?? 'inventarier'}>{Object.entries(ASSET_CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label} ({c.asset}, {Math.round(c.life / 12)} år)</option>)}</select></label>
        </div>
        <div className="row">
          <label>Anskaffningsdatum<input type="date" name="acquired_on" required defaultValue={p('date') ?? t} /></label>
          <label>Anskaffningsvärde exkl. moms<input name="cost" inputMode="decimal" required defaultValue={p('amount')} /></label>
          <label>Avskrivningstid (månader, tomt = standard)<input name="life_months" type="number" min={1} max={1200} /></label>
          <label>Restvärde<input name="residual" inputMode="decimal" defaultValue="0" /></label>
          <label>Avskrivning från (månad)<input type="date" name="dep_start" /></label>
          {ccs.length > 0 && <label>Kostnadsställe<select name="cost_center_id" defaultValue=""><option value="">–</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>}
        </div>
        <label>Anteckning<input name="notes" /></label>
        <div><button>Lägg upp tillgång</button></div>
      </form>
    </div>
  );
}
