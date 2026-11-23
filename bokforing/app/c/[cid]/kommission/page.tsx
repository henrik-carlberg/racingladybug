import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/commission-sales';
import { principalAction, receiveAction, returnAction, sellAction, settleAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { in_stock: 'I kommission', sold: 'Såld', returned: 'Återlämnad' };

export default async function Commission({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id, Number(sp.nota) || undefined);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Kommissionsförsäljning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Varor som du säljer i eget namn för en huvudmans räkning ingår inte i ditt lager. Vid försäljning tas moms ut på hela priset, men bara provisionen är intäkt (3045) – resten är skuld till huvudmannen (2895).
        Är huvudmannen momsregistrerad lämnar hen moms på sin del, som dras av som ingående moms. Avräkningsnotan betalar ut det huvudmannen har att få.</p>
      {o.settlement && <section className="card stack cm-nota">
        <h2 style={{ margin: 0 }}>Avräkningsnota {o.settlement.id}: {o.settlement.principal} {o.settlement.date}</h2>
        <table><thead><tr><th>Vara</th><th>Såld</th><th className="num">Pris exkl. moms</th><th className="num">Provision</th><th className="num">Er del</th><th className="num">Moms på er del</th></tr></thead>
          <tbody>{o.settlementItems.map((i) => <tr key={i.id}><td>{i.description}</td><td>{i.sold_on}</td><td className="num">{kr(i.sale_price ?? 0)}</td><td className="num">{kr(i.commission ?? 0)}</td><td className="num">{kr(i.principal_share ?? 0)}</td><td className="num">{kr(i.principal_vat ?? 0)}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={5}>Utbetalas</th><th className="num cm-nota-total">{kr(o.settlement.amount)}</th></tr></tfoot></table>
      </section>}
      <div className="row"><div className="card stat"><div className="label">Skuld till huvudmän 2895</div><div className="value cm-debt">{kr(o.debt)}</div></div></div>
      <table className="cm-principals"><thead><tr><th>Huvudman</th><th className="num">Provision</th><th>Moms</th><th className="num">I kommission</th><th className="num">Att avräkna</th><th></th></tr></thead>
        <tbody>{o.principals.map((p) => <tr key={p.id} className="cm-prow" data-name={p.name}><td>{p.name}</td><td className="num">{p.commission_pct.toLocaleString('sv-SE')} %</td><td className="small">{p.vat_registered ? 'Momsregistrerad' : 'Privatperson'}</td>
          <td className="num">{p.in_stock}</td><td className="num cm-unsettled">{kr(p.unsettled)}</td>
          <td>{p.to_settle > 0 && <form action={settleAction.bind(null, id, p.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Avräkna och betala ut</button></form>}</td></tr>)}
          {!o.principals.length && <tr><td colSpan={6} className="muted">Inga huvudmän ännu.</td></tr>}</tbody></table>
      <table className="cm-items"><thead><tr><th>Vara</th><th>Huvudman</th><th>Mottagen</th><th className="num">Begärt pris</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.items.map((i) => <tr key={i.id} className="cm-row" data-description={i.description} data-status={i.status}><td>{i.description}</td><td>{i.principal}</td><td>{i.received_on}</td><td className="num">{i.ask_price ? kr(i.ask_price) : ''}</td>
          <td className="small">{STATUS[i.status]}{i.sold_on && ` ${i.sold_on}: ${kr((i.sale_price ?? 0) + (i.sale_vat ?? 0))} kr`}</td>
          <td>{i.status === 'in_stock' && <div className="row" style={{ gap: '.25rem' }}>
            <form action={sellAction.bind(null, id, i.id)} className="row" style={{ gap: '.25rem' }}><input name="price" placeholder="Pris inkl. moms" defaultValue={i.ask_price ? String(i.ask_price / 100).replace('.', ',') : ''} inputMode="decimal" style={{ width: '7rem' }} /><input type="date" name="date" defaultValue={t} /><button className="link">Sålt</button></form>
            <form action={returnAction.bind(null, id, i.id)}><input type="hidden" name="date" value={t} /><button className="link">Återlämna</button></form></div>}</td></tr>)}
          {!o.items.length && <tr><td colSpan={6} className="muted">Inga varor i kommission.</td></tr>}</tbody></table>
      {o.principals.length > 0 && <form action={receiveAction.bind(null, id)} className="card row">
        <label>Huvudman<select name="principal_id">{o.principals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Vara<input name="description" required /></label>
        <label>Begärt pris inkl. moms<input name="ask_price" inputMode="decimal" style={{ width: '7rem' }} /></label>
        <label>Moms<select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
        <label>Mottagen<input type="date" name="received_on" defaultValue={t} /></label>
        <button>Ta emot vara</button>
      </form>}
      {o.settlements.length > 0 && <><h2>Avräkningsnotor</h2><table><tbody>{o.settlements.map((s) => <tr key={s.id}><td><a href={`/c/${id}/kommission?nota=${s.id}`}>Nota {s.id}</a></td><td>{s.principal}</td><td>{s.date}</td><td className="num">{kr(s.amount)}</td></tr>)}</tbody></table></>}
      <h2>Ny huvudman</h2>
      <form action={principalAction.bind(null, id)} className="row">
        <label>Namn<input name="name" required /></label>
        <label>Provision %<input name="commission_pct" inputMode="decimal" required style={{ width: '5rem' }} /></label>
        <label>Bankkonto för utbetalning<input name="bank_account" /></label>
        <label className="row"><input type="checkbox" name="vat_registered" /> Momsregistrerad</label>
        <button>Lägg upp huvudman</button>
      </form>
    </div>
  );
}
