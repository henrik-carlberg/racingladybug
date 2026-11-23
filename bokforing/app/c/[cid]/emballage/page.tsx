import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/packaging';
import { deliverAction, forfeitAction, returnAction, typeAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Packaging({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  const pick = (<>
    <label>Kund<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Förpackning<select name="type_id">{o.types.map((x) => <option key={x.id} value={x.id}>{x.name} ({kr(x.deposit)} kr)</option>)}</select></label>
    <label>Antal<input name="quantity" inputMode="numeric" style={{ width: '5rem' }} /></label>
    <label>Datum<input type="date" name="date" defaultValue={t} required /></label></>);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Returemballage och pant</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Pallar, fat, backar och annat emballage som ska komma tillbaka. Panten faktureras som egen rad utan moms mot pantskulden 2899 – den är ingen intäkt – och krediteras när emballaget lämnas tillbaka.
        Emballage som inte kommer tillbaka kan förverkas: panten tas då upp som intäkt.</p>
      <div className="row">
        <div className="card stat"><div className="label">Utestående pant</div><div className="value pk-total">{kr(o.total)}</div></div>
        <div className="card stat"><div className="label">Pantskuld 2899</div><div className="value pk-ledger">{kr(o.ledger)}</div></div>
      </div>
      <table className="pk-list"><thead><tr><th>Kund</th><th>Förpackning</th><th className="num">Hos kunden</th><th className="num">Pant</th><th>Senast utlämnat</th><th>Senast returnerat</th><th></th></tr></thead>
        <tbody>{o.rows.map((r) => (
          <tr key={`${r.customer_id}-${r.type_id}`} className="pk-row" data-customer={r.customer} data-type={r.type}><td>{r.customer}</td><td>{r.type}</td><td className="num pk-qty">{r.qty}</td><td className="num pk-value">{kr(r.value)}</td>
            <td>{r.lastOut ?? ''}</td><td>{r.lastReturn ?? ''}{r.stale && <div className="small" style={{ color: 'var(--danger)' }}>Inget returnerat på över ett halvår</div>}</td>
            <td><form action={forfeitAction.bind(null, id)} className="row" style={{ gap: '.25rem' }}><input type="hidden" name="customer_id" value={r.customer_id} /><input type="hidden" name="type_id" value={r.type_id} />
              <input type="hidden" name="date" value={t} /><button className="link">Förverka panten</button></form></td></tr>))}
          {!o.rows.length && <tr><td colSpan={7} className="muted">Inget emballage hos kunder.</td></tr>}</tbody></table>
      {o.types.length > 0 && o.customers.length > 0 && <div className="row" style={{ alignItems: 'start' }}>
        <form action={deliverAction.bind(null, id)} className="card stack"><b>Lämna ut emballage</b>{pick}<button>Fakturera pant</button></form>
        <form action={returnAction.bind(null, id)} className="card stack"><b>Ta emot returnerat emballage</b>{pick}<button>Kreditera pant</button></form>
      </div>}
      <h2>Förpackningstyper</h2>
      <table><tbody>{o.types.map((x) => <tr key={x.id}><td>{x.name}</td><td className="num">{kr(x.deposit)} kr</td></tr>)}{!o.types.length && <tr><td className="muted">Inga förpackningstyper ännu.</td></tr>}</tbody></table>
      <form action={typeAction.bind(null, id)} className="row">
        <label>Förpackningstyp<input name="name" required placeholder="t.ex. EUR-pall" /></label>
        <label>Pant (kr)<input name="deposit" inputMode="decimal" required style={{ width: '7rem' }} /></label>
        <button>Lägg upp förpackning</button>
      </form>
    </div>
  );
}
