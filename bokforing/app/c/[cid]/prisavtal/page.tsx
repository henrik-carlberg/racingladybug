import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/customer-prices';
import { agreementAction, endAction, groupAction, memberAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PriceAgreements({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Kundprisavtal</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Kundens pris på en kundorder är det lägsta av listpriset med kundgruppens rabatt och de avtal som gäller för dagen och antalet: kundspecifika nettopriser, rabatter och volymrabatter för kunden eller dess grupp.</p>
      <table className="pa-list"><thead><tr><th>Kund / grupp</th><th>Artikel</th><th className="num">Listpris</th><th className="num">Avtal</th><th className="num">Från antal</th><th>Giltigt</th><th></th></tr></thead>
        <tbody>{o.agreements.map((a) => (
          <tr key={a.id} className="pa-row" data-party={a.party} style={a.active ? undefined : { opacity: 0.5 }}><td>{a.party} <span className="small muted">{a.scope === 'group' ? '(grupp)' : ''}</span></td><td>{a.product}</td><td className="num">{kr(a.list)}</td>
            <td className="num">{a.net_price != null ? `${kr(a.net_price)} kr` : `−${a.discount_pct!.toLocaleString('sv-SE')} %`}</td><td className="num">{a.min_qty || ''}</td>
            <td className="small">{a.valid_from}–{a.valid_to ?? ''}{a.expiring && <div className="pa-expiring" style={{ color: 'var(--danger)' }}>Går snart ut</div>}</td>
            <td>{a.active && <form action={endAction.bind(null, id, a.id)}><button className="link">Avsluta</button></form>}</td></tr>))}
          {!o.agreements.length && <tr><td colSpan={7} className="muted">Inga prisavtal ännu.</td></tr>}</tbody></table>
      {o.products.length > 0 && <form action={agreementAction.bind(null, id)} className="card row">
        <label>Kund eller grupp<select name="party">{o.groups.map((g) => <option key={`g${g.id}`} value={`g:${g.id}`}>Grupp: {g.name}</option>)}{o.customers.map((c) => <option key={`c${c.id}`} value={`c:${c.id}`}>{c.name}</option>)}</select></label>
        <label>Artikel<select name="product_id">{o.products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label>Nettopris (kr)<input name="net_price" inputMode="decimal" style={{ width: '6rem' }} /></label>
        <label>eller rabatt %<input name="discount_pct" inputMode="decimal" style={{ width: '5rem' }} /></label>
        <label>Från antal<input name="min_qty" inputMode="decimal" style={{ width: '5rem' }} /></label>
        <label>Gäller från<input type="date" name="valid_from" defaultValue={t} /></label>
        <label>till<input type="date" name="valid_to" /></label>
        <button>Lägg upp avtal</button>
      </form>}

      <h2>Kundgrupper</h2>
      <table className="pa-groups"><tbody>{o.groups.map((g) => <tr key={g.id}><td>{g.name}</td><td className="num">{g.discount_pct.toLocaleString('sv-SE')} %</td><td className="small muted">{g.customers} kunder</td></tr>)}
        {!o.groups.length && <tr><td className="muted">Inga kundgrupper ännu.</td></tr>}</tbody></table>
      <div className="row">
        <form action={groupAction.bind(null, id)} className="row"><label>Ny grupp<input name="name" required /></label><label>Rabatt %<input name="discount_pct" inputMode="decimal" style={{ width: '5rem' }} /></label><button className="secondary">Lägg upp grupp</button></form>
        {o.groups.length > 0 && <form action={memberAction.bind(null, id)} className="row">
          <label>Kund<select name="customer_id">{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.group_id ? ` (${o.groups.find((g) => g.id === c.group_id)?.name})` : ''}</option>)}</select></label>
          <label>Grupp<select name="group_id"><option value="">Ingen</option>{o.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <button className="secondary">Spara grupp</button></form>}
      </div>

      <h2>Marginal per kund (kundorder, 12 månader)</h2>
      <table className="pa-margins"><thead><tr><th>Kund</th><th className="num">Försäljning</th><th className="num">Anskaffningsvärde</th><th className="num">Marginal</th><th className="num">%</th></tr></thead>
        <tbody>{o.margins.map((m) => <tr key={m.customer} data-customer={m.customer}><td>{m.customer}</td><td className="num pa-rev">{kr(m.revenue)}</td><td className="num">{kr(m.cost)}</td><td className="num">{kr(m.margin)}</td><td className="num pa-pct">{m.pct.toLocaleString('sv-SE')} %</td></tr>)}
          {!o.margins.length && <tr><td colSpan={5} className="muted">Inga kundorder ännu.</td></tr>}</tbody></table>
    </div>
  );
}
