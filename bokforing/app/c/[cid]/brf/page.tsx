import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { maxPledgeFee, maxTransferFee } from '@/lib/brf';
import { isBrf, overview } from '@/lib/services/brf';
import { apartment, budget, fees, fund, maintenance, maintenanceDone, pledge, release, toggle, transfer } from './actions';

export const dynamic = 'force-dynamic';

export default async function Brf({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, owner = ctx.role === 'owner';
  const t0 = today();
  const y = Number(String(sp.ar ?? '').slice(0, 4)) || Number(t0.slice(0, 4));
  if (!(await isBrf(id))) return (
    <div style={{ maxWidth: 800 }}>
      <h1>Bostadsrättsförening</h1><Flash searchParams={searchParams} />
      <p>Läget för bostadsrättsföreningar ger lägenhetsförteckning enligt bostadsrättslagen, avgiftsavier efter andelstal, överlåtelser och pantsättningar, underhållsplan med fond för yttre underhåll och de nyckeltal som ska stå i årsredovisningen. Årets resultat förs till 2069 och balanseras på 2068 enligt föreningsstämman.</p>
      {owner ? <form action={toggle.bind(null, id, true)}><button className="enable-brf">Slå på bostadsrättsföreningsläget</button></form> : <p className="muted">Ägaren slår på läget.</p>}
    </div>
  );
  const o = await overview(id, y);
  const nextMonth = (() => { const [yy, m] = t0.split('-').map(Number); return m === 12 ? `${yy + 1}-01` : `${yy}-${String(m + 1).padStart(2, '0')}`; })();
  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="header"><h1>Bostadsrättsförening {y}</h1><div className="row"><Link href={`?ar=${y - 1}`}>← {y - 1}</Link><Link href={`?ar=${y + 1}`}>{y + 1} →</Link><a className="btn secondary" href={`/c/${id}/brf/forteckning`} target="_blank">Lägenhetsförteckning</a></div></div>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Lägenheter</div><div className="value apt-count">{o.apts.length}</div><div className="small muted">{o.key.area.br.toLocaleString('sv-SE')} kvm bostadsrätt</div></div>
        <div className="card stat"><div className="label">Summa andelstal</div><div className={`value share-sum ${o.shares.ok ? '' : 'warn'}`}>{o.shares.sum.toLocaleString('sv-SE')}</div>{!o.shares.ok && <div className="small" style={{ color: 'var(--danger)' }}>ska vara 1 eller 100</div>}</div>
        <div className="card stat"><div className="label">Fond för yttre underhåll</div><div className="value fund-balance">{kr(o.key.fund.closing)}</div></div>
      </div>

      <h2>Lägenhetsförteckning</h2>
      <div className="table-wrap"><table className="apartments">
        <thead><tr><th>Lgh</th><th>Skv-nr</th><th className="num">Kvm</th><th className="num">Andelstal</th><th>Bostadsrättshavare</th><th className="num">Avgift/period</th><th>Pantsättningar</th><th></th></tr></thead>
        <tbody>{o.apts.map((a) => {
          const cur = o.current(a.id);
          const pl = o.pledges.filter((p) => p.apartment_id === a.id && !p.released_on);
          return (
            <tr key={a.id} className="apartment"><td>{a.number}</td><td>{a.skv_number}</td><td className="num">{a.area.toLocaleString('sv-SE')}</td><td className="num">{a.share.toLocaleString('sv-SE', { maximumFractionDigits: 6 })}</td>
              <td>{cur.map((c) => c.name).join(', ')}<div className="small muted">sedan {cur[0]?.from_date}</div></td>
              <td className="num apt-fee">{o.fees.has(a.id) ? kr(o.fees.get(a.id)!) : ''}</td>
              <td>{pl.map((p) => <form key={p.id} action={release.bind(null, id, p.id)} className="row pledge"><span>{p.lender} {p.date}</span><button className="secondary">Avregistrera</button></form>)}</td>
              <td><details><summary>Överlåtelse / pant</summary>
                <form action={transfer.bind(null, id, a.id)} className="stack" style={{ marginTop: 8 }}>
                  <label>Köpare<input name="buyer" required /></label><label>E-post<input name="email" type="email" /></label>
                  <label>Tillträde<input type="date" name="date" defaultValue={t0} required /></label><label>Pris (kr)<input name="price" inputMode="decimal" /></label>
                  <label className="check"><input type="checkbox" name="charge_fee" defaultChecked /> Fakturera överlåtelseavgift ({kr(maxTransferFee(y))})</label>
                  <button className="secondary">Registrera överlåtelse</button></form>
                <form action={pledge.bind(null, id, a.id)} className="stack" style={{ marginTop: 8 }}>
                  <label>Långivare<input name="lender" required /></label><label>Lån (kr)<input name="amount" inputMode="decimal" /></label>
                  <label className="check"><input type="checkbox" name="charge_fee" defaultChecked /> Fakturera pantsättningsavgift ({kr(maxPledgeFee(y))})</label>
                  <button className="secondary">Notera pantsättning</button></form>
              </details></td></tr>
          );
        })}</tbody>
      </table></div>
      <form action={apartment.bind(null, id)} className="card stack">
        <b>Ny lägenhet</b>
        <div className="row"><label>Lgh<input name="number" required /></label><label>Skatteverkets nr<input name="skv_number" /></label><label>Våning<input name="floor" /></label><label>Rum<input name="rooms" /></label>
          <label>Kvm<input name="area" inputMode="decimal" required /></label><label>Andelstal<input name="share" inputMode="decimal" required /></label></div>
        <div className="row"><label>Bostadsrättshavare<input name="owner" required /></label><label>E-post<input name="email" type="email" /></label>
          <label>Insats (kr)<input name="insats" inputMode="decimal" /></label><label>Upplåten<input type="date" name="granted_on" /></label></div>
        <div><button>Lägg till lägenhet</button></div>
      </form>
      {o.transfers.length > 0 && <><h3>Senaste överlåtelser</h3><ul className="transfers">{o.transfers.map((t, i) => <li key={i}>{t.date}: lgh {o.apts.find((a) => a.id === t.apartment_id)?.number} från {t.seller} till {t.buyer}{t.price ? ` för ${kr(t.price)}` : ''}</li>)}</ul></>}

      <h2>Avgifter {y}</h2>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <form action={budget.bind(null, id)} className="card stack" style={{ flex: '1 1 300px' }}><input type="hidden" name="year" value={y} />
          <b>Årets avgifter</b>
          <label>Årsavgifter totalt (kr)<input name="fee_budget" inputMode="decimal" defaultValue={o.budget ? String(o.budget.fee_budget / 100) : ''} required /></label>
          <label>Avisering<select name="periods" defaultValue={String(o.budget?.periods ?? 12)}><option value="12">Månadsvis</option><option value="4">Kvartalsvis</option></select></label>
          <div><button className="secondary">Spara</button></div>
          <p className="small muted" style={{ margin: 0 }}>Avgiften fördelas efter andelstal.</p>
        </form>
        <form action={fees.bind(null, id)} className="card stack" style={{ flex: '1 1 300px' }}>
          <b>Avgiftsavier</b>
          <label>Avser månad<input name="month" defaultValue={nextMonth} pattern="\d{4}-\d{2}" /></label>
          <p className="small muted" style={{ margin: 0 }}>En momsfri avi med OCR per lägenhet till bostadsrättshavaren, bokförd på 3912. Redan aviserade perioder hoppas över.</p>
          <div><button>Skapa avgiftsavier</button></div>
        </form>
      </div>
      {o.invoiced.length > 0 && <table className="fee-periods"><thead><tr><th>Period</th><th className="num">Avier</th><th className="num">Belopp</th><th className="num">Betalt</th></tr></thead>
        <tbody>{o.invoiced.map((p) => <tr key={p.period} className="fee-period"><td>{p.period}</td><td className="num">{p.n}</td><td className="num">{kr(p.total)}</td><td className="num">{kr(p.paid)}</td></tr>)}</tbody></table>}

      <h2>Underhållsplan och fond</h2>
      <div className="table-wrap"><table className="maintenance">
        <thead><tr><th>År</th><th>Åtgärd</th><th className="num">Belopp</th><th></th></tr></thead>
        <tbody>{o.maintenance.map((m) => <tr key={m.id} className="maint"><td>{m.year}</td><td>{m.item}</td><td className="num">{kr(m.amount)}</td>
          <td>{m.done ? <span className="badge ok">Utförd</span> : <form action={maintenanceDone.bind(null, id, m.id)}><button className="secondary">Utförd</button></form>}</td></tr>)}</tbody>
      </table></div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <form action={maintenance.bind(null, id)} className="card row" style={{ flex: '2 1 400px' }}>
          <label>År<input name="year" type="number" defaultValue={y + 1} /></label><label style={{ flex: '2 1 200px' }}>Åtgärd<input name="item" required /></label><label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label>
          <button className="secondary">Lägg till</button>
        </form>
        <form action={fund.bind(null, id)} className="card stack" style={{ flex: '1 1 260px' }}>
          <label>Fond för yttre underhåll<select name="kind"><option value="reserve">Avsättning (stämmobeslut)</option><option value="use">Ianspråktagande</option></select></label>
          <div className="row"><label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label><label>Datum<input type="date" name="date" defaultValue={t0} /></label></div>
          <div><button className="secondary">Bokför</button></div>
        </form>
      </div>

      <h2>Nyckeltal {y}</h2>
      <table className="brf-keys"><tbody>{o.key.rows.map((r) => <tr key={r.key} className={`key-${r.key}`}><td>{r.label}</td><td className="num">{r.value.toLocaleString('sv-SE')}</td></tr>)}</tbody></table>
      <p className="small muted">Nyckeltalen tas med i förvaltningsberättelsen i årsredovisningen (BFNAR 2023:1). Energi: konto 5020–5049. Planerat underhåll: utförda åtgärder i underhållsplanen. Total yta inkluderar lokaler under Fastighet.</p>
      {owner && <form action={toggle.bind(null, id, false)} style={{ marginTop: 32 }}><button className="secondary">Stäng av bostadsrättsföreningsläget</button></form>}
    </div>
  );
}
