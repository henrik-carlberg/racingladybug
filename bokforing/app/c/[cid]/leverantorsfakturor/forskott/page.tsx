import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/supplier-prepayments';
import { prepayAction, refundAction, settleAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SupplierPrepayments({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payments' });
  const id = company.id;
  const { list, open, suppliers, ledger, outstanding } = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Förskott till leverantörer</h1>
      <p className="small"><Link href={`/c/${id}/leverantorsfakturor`}>← Leverantörsfakturor</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Ett förskott bokförs som fordran på leverantören (debet 1480, kredit 1930). När slutfakturan kommer avräknas förskottet (debet 2440, kredit 1480) och bara mellanskillnaden återstår att betala.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Ej avräknade förskott</div><div className="value pp-outstanding">{kr(outstanding)}</div></div>
        <div className="card stat"><div className="label">Saldo på 1480</div><div className="value pp-ledger">{kr(ledger)}</div>
          <div className="small" style={{ color: ledger === outstanding ? 'var(--ok)' : 'var(--danger)' }}>{ledger === outstanding ? 'Stämmer ✓' : `Skillnad ${kr(ledger - outstanding)}`}</div></div>
      </div>
      <table className="pp-list"><thead><tr><th>Leverantör</th><th>Datum</th><th className="num">Förskott</th><th className="num">Kvar</th><th>Avräkna</th></tr></thead>
        <tbody>{list.map((p) => {
          const inv = open.filter((i) => i.supplier_id === p.supplier_id);
          const left = p.amount - p.used;
          return (
            <tr key={p.id} className="pp-row" data-supplier={p.supplier}><td>{p.supplier}{p.note && <div className="small muted">{p.note}</div>}</td><td>{p.date}</td><td className="num">{kr(p.amount)}</td><td className="num pp-left">{kr(left)}</td>
              <td>{left > 0 && <div className="stack" style={{ gap: '.25rem' }}>
                {inv.length > 0 && <form action={settleAction.bind(null, id, p.id)} className="row" style={{ gap: '.25rem' }}>
                  <select name="invoice_id">{inv.map((i) => <option key={i.id} value={i.id}>{i.number} ({kr(i.remaining)} kr)</option>)}</select>
                  <input type="date" name="date" defaultValue={t} /><button className="link">Avräkna</button></form>}
                <form action={refundAction.bind(null, id, p.id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button className="link">Återbetalt</button></form>
              </div>}</td></tr>);
        })}
          {!list.length && <tr><td colSpan={5} className="muted">Inga förskott.</td></tr>}</tbody></table>
      <h2>Nytt förskott</h2>
      <form action={prepayAction.bind(null, id)} className="card row" style={{ alignItems: 'end' }}>
        <label>Leverantör<select name="supplier_id" required>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Belopp (kr)<input name="amount" inputMode="decimal" required /></label>
        <label>Betalt<input type="date" name="date" defaultValue={t} required /></label>
        <label style={{ flex: '1 1 200px' }}>Notering<input name="note" maxLength={300} /></label>
        <button>Bokför förskott</button>
      </form>
    </div>
  );
}
