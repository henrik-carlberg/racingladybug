import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/cashbook';
import { count } from './actions';

export const dynamic = 'force-dynamic';

/** Kassabok för kontantkassan (1910) med kassainventering */
export default async function Cashbook({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const t = today();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.from ?? '')) ? String(sp.from) : `${t.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.to ?? '')) ? String(sp.to) : t;
  const o = await overview(company.id, from, to);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Kassabok</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Kassaboken visar in- och utbetalningar i kontantkassan (1910) dag för dag med löpande saldo. Kassan kan aldrig ha ett negativt saldo – händer det saknas en insättning eller är något felbokfört.
        Räkna kassan regelbundet och minst en gång i månaden; skillnaden mot bokfört saldo bokförs som kassadifferens (3740).</p>
      {o.negative.length > 0 && <div className="card cb-negative" style={{ borderColor: 'var(--danger)' }}>⛔ Kassans saldo är negativt {o.negative.slice(0, 5).join(', ')} – kontrollera bokföringen.</div>}
      {o.overdue && <div className="card cb-overdue" style={{ borderColor: 'var(--warn)' }}>⚠️ Kassan har inte räknats på över 30 dagar{o.last ? ` (senast ${o.last})` : ''}.</div>}
      <form className="row" method="get"><label>Från<input type="date" name="from" defaultValue={from} /></label><label>Till<input type="date" name="to" defaultValue={to} /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div></form>
      <table className="cb-book"><thead><tr><th>Datum</th><th>Ver</th><th>Text</th><th className="num">In</th><th className="num">Ut</th><th className="num">Saldo</th></tr></thead>
        <tbody><tr><td colSpan={5}>Ingående saldo</td><td className="num">{kr(o.opening)}</td></tr>
          {o.entries.map((e, i) => <tr key={i} className={e.negative ? 'cb-neg' : ''} style={e.negative ? { color: 'var(--danger)' } : {}}><td>{e.date}</td><td><Link href={`${b}/verifikationer/${e.voucher_id}`}>{e.label}</Link></td><td>{e.text}</td>
            <td className="num">{e.amount > 0 ? kr(e.amount) : ''}</td><td className="num">{e.amount < 0 ? kr(-e.amount) : ''}</td><td className="num">{kr(e.balance)}</td></tr>)}
          <tr><td colSpan={5}><b>Utgående saldo</b></td><td className="num cb-closing"><b>{kr(o.closing)}</b></td></tr></tbody></table>
      <form action={count.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: 0 }}>Kassainventering</h3>
        <div className="row"><label>Datum<input type="date" name="date" defaultValue={t} /></label><label>Räknat belopp (kr)<input name="counted" required /></label><label>Räknad av<input name="counted_by" required maxLength={100} /></label></div>
        <label className="check"><input type="checkbox" name="confirm" /> Bokför även en differens över 1 000 kr</label>
        <div><button>Spara kassainventering</button></div>
      </form>
      {o.counts.length > 0 && <table className="small cb-counts"><tbody>{o.counts.map((c) => <tr key={c.id}><td>{c.date}</td><td>{c.counted_by}</td><td className="num">{kr(c.counted)}</td><td className="num">{kr(c.booked)}</td><td className="num">{kr(c.diff)}</td></tr>)}</tbody></table>}
    </div>
  );
}
