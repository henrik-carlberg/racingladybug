'use client';
import { useState } from 'react';
import { parseAmount, formatAmount } from '@/lib/money';

type Supplier = { id: number; name: string; default_account: number };

export function SupplierInvoiceForm({ action, suppliers, accounts, today }: {
  action: (fd: FormData) => Promise<void>;
  suppliers: Supplier[]; accounts: { number: number; name: string }[]; today: string;
}) {
  const [sid, setSid] = useState('');
  const [total, setTotal] = useState('');
  const [vat, setVat] = useState('');
  const [rows, setRows] = useState([{ account: '', amount: '', text: '' }]);
  const tot = parseAmount(total) ?? 0;
  const v = parseAmount(vat) ?? 0;
  const rowSum = rows.reduce((s, r) => s + (parseAmount(r.amount) ?? 0), 0);
  const diff = tot - v - rowSum;
  const fmt = (o: number) => formatAmount(o).replace(/ /g, '');
  const onSupplier = (id: string) => {
    setSid(id);
    const s = suppliers.find((x) => String(x.id) === id);
    if (s && !rows[0].account) setRows((r) => [{ ...r[0], account: String(s.default_account) }, ...r.slice(1)]);
  };
  const vat25 = () => { if (tot) { const x = Math.round(tot / 5); setVat(fmt(x)); if (rows.length === 1) setRows([{ ...rows[0], amount: fmt(tot - x) }]); } };
  return (
    <form action={action} className="stack">
      <div className="card stack">
        <div className="row">
          <label style={{ flex: '2 1 260px' }}>Leverantör
            <select name="supplier_id" value={sid} onChange={(e) => onSupplier(e.target.value)} required>
              <option value="">Välj…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Leverantörens fakturanr<input name="invoice_number" required /></label>
          <label>OCR / meddelande<input name="payment_reference" /></label>
        </div>
        <div className="row">
          <label>Fakturadatum<input type="date" name="invoice_date" defaultValue={today} required /></label>
          <label>Förfallodatum<input type="date" name="due_date" required /></label>
          <label>Att betala (inkl. moms)<input name="total" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" required /></label>
          <label>Varav moms<input name="vat" value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" /></label>
          <div style={{ flex: '0 0 auto' }}><button type="button" className="secondary" onClick={vat25}>25 % moms</button></div>
        </div>
        <label>Beskrivning<input name="description" /></label>
      </div>
      <datalist id="cost-accounts">{accounts.map((a) => <option key={a.number} value={a.number}>{a.name}</option>)}</datalist>
      <table>
        <thead><tr><th style={{ width: 140 }}>Kostnadskonto</th><th>Kontonamn</th><th className="num" style={{ width: 160 }}>Belopp exkl. moms</th><th>Text</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input name={`account_${i}`} list="cost-accounts" value={r.account} onChange={(e) => setRows((x) => x.map((y, j) => j === i ? { ...y, account: e.target.value } : y))} /></td>
              <td className="small muted">{accounts.find((a) => String(a.number) === r.account)?.name}</td>
              <td><input name={`amount_${i}`} value={r.amount} inputMode="decimal" style={{ textAlign: 'right' }} onChange={(e) => setRows((x) => x.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))} /></td>
              <td><input name={`text_${i}`} value={r.text} onChange={(e) => setRows((x) => x.map((y, j) => j === i ? { ...y, text: e.target.value } : y))} /></td>
              <td>{rows.length > 1 && <button type="button" className="link" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>
          ))}
          <tr className="sum"><td colSpan={2}>Kvar att kontera</td><td className="num" style={{ color: diff ? 'var(--danger)' : undefined }}>{formatAmount(diff)}</td><td colSpan={2}></td></tr>
        </tbody>
      </table>
      <div className="actions" style={{ margin: 0 }}>
        {rows.length < 6 && <button type="button" className="secondary" onClick={() => setRows((x) => [...x, { account: '', amount: diff > 0 ? fmt(diff) : '', text: '' }])}>+ Rad</button>}
      </div>
      <label>Fakturan som fil (PDF/bild)<input type="file" name="file" accept="image/*,application/pdf" /></label>
      <div><button disabled={diff !== 0 || !tot}>Registrera och bokför</button></div>
      <p className="muted small">Bokförs enligt faktureringsmetoden: kostnad och ingående moms mot leverantörsskuld (2440) på fakturadatum.</p>
    </form>
  );
}
