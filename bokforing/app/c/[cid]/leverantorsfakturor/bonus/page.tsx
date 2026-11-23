import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { tiersText } from '@/lib/rebates';
import { overview } from '@/lib/services/rebates';
import { accrueAction, addAction, receiveAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SupplierRebates({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'purchasing' });
  const id = company.id;
  const { rows, customers: suppliers, fys } = await overview(id, 'supplier');
  const t = today();
  const openFys = fys.filter((f) => !f.closed);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Leverantörsbonus</h1>
      <p className="small"><Link href={`/c/${id}/leverantorsfakturor`}>← Leverantörsfakturor</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Bonus i efterhand på inköpen (exkl. moms) från leverantören. Den högsta nivå som inköpen når gäller på hela volymen. Vid bokslut bokförs intjänad bonus som upplupen intäkt
        (debet 1790, kredit 4730). När bonusen betalas ut eller kommer som kreditnota minskas den ingående momsen och det upplupna löses upp.</p>
      <table className="sb-list"><thead><tr><th>Leverantör</th><th>Period</th><th>Trappsteg</th><th className="num">Inköp</th><th className="num">Bonus</th><th>Nästa steg</th><th className="num">Upplupet</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="sb-row" data-supplier={r.party}><td>{r.party}{r.note && <div className="small muted">{r.note}</div>}</td><td>{r.start} – {r.end}</td><td className="small">{tiersText(r.tiers)}</td>
            <td className="num sb-volume">{kr(r.volume)}</td><td className="num sb-amount">{kr(r.amount)}{r.pct ? <div className="small muted">{r.pct / 100} %</div> : null}</td>
            <td className="small">{r.next && !r.ended ? `${kr(r.toNext)} kr kvar till ${r.next.pct / 100} %` : ''}</td><td className="num sb-accrued">{kr(r.accrued)}</td>
            <td>{r.settled_at ? <span className="small">Mottagen {r.settled_at}</span>
              : r.ended ? <form action={receiveAction.bind(null, id, r.id)} className="stack" style={{ gap: '.25rem' }}>
                  <select name="method"><option value="bank">Utbetald till banken</option><option value="credit">Kreditnota</option></select>
                  <input name="credit_number" placeholder="Kreditnotans nr" /><input type="date" name="date" defaultValue={t} /><button className="link">Ta emot bonus</button></form>
              : <span className="small muted">Pågår</span>}</td></tr>))}
          {!rows.length && <tr><td colSpan={8} className="muted">Inga bonusavtal.</td></tr>}</tbody></table>
      {openFys.length > 0 && rows.some((r) => !r.settled_at) && (
        <form action={accrueAction.bind(null, id)} className="card row" style={{ alignItems: 'end', marginTop: '1rem' }}>
          <label>Bokslut<select name="fiscal_year_id">{openFys.map((f) => <option key={f.id} value={f.id}>{f.start} – {f.end}</option>)}</select></label>
          <button className="secondary">Bokför upplupen bonus</button>
        </form>)}
      <h2>Nytt bonusavtal</h2>
      <form action={addAction.bind(null, id)} className="card stack">
        <div className="row">
          <label>Leverantör<select name="supplier_id" required>{suppliers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Från<input type="date" name="start_date" defaultValue={`${t.slice(0, 4)}-01-01`} required /></label>
          <label>Till<input type="date" name="end_date" defaultValue={`${t.slice(0, 4)}-12-31`} required /></label>
          <label>Moms<select name="vat_rate" defaultValue="25"><option>25</option><option>12</option><option>6</option><option>0</option></select></label>
        </div>
        <label>Trappsteg (inköp i kr från och med : bonus i %)<input name="tiers" placeholder="200000:1; 500000:2" required /></label>
        <label>Notering<input name="note" maxLength={300} /></label>
        <div><button>Lägg upp avtal</button></div>
      </form>
    </div>
  );
}
