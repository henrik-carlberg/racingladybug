import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { KINDS } from '@/lib/it-equipment';
import { overview } from '@/lib/services/it-equipment';
import { addAction, assignAction, closeAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { in_use: 'Utlämnad', in_stock: 'I lager', retired: 'Kasserad', lost: 'Förlorad' };

export default async function Equipment({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const { items, employees, assets, returns, perHolder } = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>IT-utrustning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Inventarielista över datorer, telefoner och annan utrustning: vem som har vad, garanti och när den ska bytas ut. Utrustning kan kopplas till inventariet i <Link href={`/c/${id}/anlaggningar`}>anläggningsregistret</Link>.
        När någon sägs upp visas en återlämningslista med allt som ska lämnas tillbaka före sista anställningsdagen.</p>
      {returns.length > 0 && <><h2>Återlämning vid uppsägning</h2>
        {returns.map((r) => <div key={r.employee_id} className="card small it-return" data-name={r.name} data-done={r.done ? '1' : '0'}>
          <strong>{r.name}</strong> – sista dag {r.last_day}{r.overdue && <span className="it-overdue"> · inte återlämnat i tid</span>}
          {r.done ? <div>All utrustning är återlämnad.</div> : <ul>{r.items.map((i) => <li key={i.id}>{i.name}{i.serial && ` (${i.serial})`}
            <form action={closeAction.bind(null, id, i.id, 'returned')} style={{ display: 'inline' }}> <button className="link">Återlämnad</button></form>
            <form action={closeAction.bind(null, id, i.id, 'lost')} style={{ display: 'inline' }}> <button className="link">Saknas</button></form></li>)}</ul>}</div>)}</>}
      <table className="it-list"><thead><tr><th>Utrustning</th><th>Serienummer</th><th>Hos</th><th>Inköpt</th><th className="num">Pris</th><th>Garanti</th><th>Status</th><th></th></tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.id} className="it-row" data-name={i.name} data-status={i.status}><td>{i.name}<div className="small muted">{KINDS[i.kind]}{i.asset && ` · inventarie: ${i.asset}`}</div></td><td className="small">{i.serial}</td>
            <td className="it-holder">{i.holder ?? ''}{i.assigned_on && <div className="small muted">sedan {i.assigned_on}</div>}</td>
            <td className="small">{i.purchased_on}{i.replace && <div className="it-replace">dags att byta</div>}</td><td className="num">{i.cost ? kr(i.cost) : ''}</td>
            <td className="small">{i.warranty_until}{i.warrantyIn != null && <div className="it-warranty">går ut om {i.warrantyIn} dagar</div>}</td>
            <td className="small">{STATUS[i.status]}{i.status === 'lost' && i.asset_active && <div>Utrangera inventariet i anläggningsregistret</div>}</td>
            <td>{i.status === 'in_stock' && employees.length > 0 && <form action={assignAction.bind(null, id, i.id)} className="row" style={{ gap: '.25rem' }}><select name="employee_id">{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select><button className="link">Lämna ut</button></form>}
              {i.status === 'in_use' && <form action={closeAction.bind(null, id, i.id, 'returned')}><button className="link">Återlämnad</button></form>}
              {(i.status === 'in_stock' || i.status === 'in_use') && <form action={closeAction.bind(null, id, i.id, 'retired')}><button className="link">Kassera</button></form>}</td></tr>))}
          {!items.length && <tr><td colSpan={8} className="muted">Ingen utrustning registrerad.</td></tr>}</tbody></table>
      {perHolder.length > 0 && <><h2>Per person</h2><table className="it-holders"><tbody>{perHolder.map((p) => <tr key={p.name} data-name={p.name}><td>{p.name}</td><td className="num">{p.count} st</td><td className="num">{kr(p.value)} kr</td></tr>)}</tbody></table></>}

      <h2>Ny utrustning</h2>
      <form action={addAction.bind(null, id)} className="card stack it-add">
        <div className="row">
          <label>Typ<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Benämning<input name="name" required maxLength={100} /></label>
          <label>Serienummer<input name="serial" maxLength={100} /></label>
          <label>Lämnas ut till<select name="employee_id"><option value="">– i lager –</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        </div>
        <div className="row">
          <label>Inköpt<input type="date" name="purchased_on" /></label>
          <label>Pris exkl. moms<input name="cost" inputMode="decimal" /></label>
          <label>Garanti till<input type="date" name="warranty_until" /></label>
          <label>Inventarie<select name="asset_id"><option value="">–</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        </div>
        <div><button>Spara utrustning</button></div>
      </form>
    </div>
  );
}
