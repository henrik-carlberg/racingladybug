'use client';
import { Help } from './Help';
import { useActionState, useState } from 'react';
import { parseAmount, formatAmount } from '@/lib/money';
import { computeInvoice, defaultSalesAccount } from '@/lib/invoice';
import { computeReduction, labourInclVat, REDUCTION, type ReductionType } from '@/lib/rotrut';

type FormState = { error?: string } | undefined;
type Row = { description: string; quantity: string; unit: string; price: string; vat: string; account: string; labor?: boolean };
type Customer = { id: number; name: string; reverse_charge: boolean; construction_rc?: boolean; currency?: string; language?: string };

export interface InvoiceInitial {
  customer_id?: number; advance?: boolean; currency?: string; exchange_rate?: number | string; language?: string; invoice_date: string; due_date?: string; delivery_date?: string; our_reference?: string; your_reference?: string; notes?: string; lines?: Row[];
  reduction_type?: ReductionType | null; buyer_pnr?: string; property?: string; brf_orgnr?: string; apartment_no?: string; work_type?: string; reduction_max?: number | null;
}

export function InvoiceForm({ action, customers, accounts, initial }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  customers: Customer[];
  accounts: { number: number; name: string }[];
  initial: InvoiceInitial;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [customerId, setCustomerId] = useState(String(initial.customer_id ?? ''));
  const cust = customers.find((c) => String(c.id) === customerId);
  const construction = !!cust?.construction_rc;
  const rc = (cust?.reverse_charge ?? false) || construction;
  const [currency, setCurrency] = useState(initial.currency ?? 'SEK');
  const [rate, setRate] = useState(initial.exchange_rate ? String(initial.exchange_rate).replace('.', ',') : '');
  const [lang, setLang] = useState(initial.language ?? 'sv');
  const foreign = currency !== 'SEK';
  const [advance, setAdvance] = useState(!!initial.advance);
  const salesAcc = (vat: number) => (advance ? 2420 : construction ? 3231 : defaultSalesAccount(vat, rc));
  const blank = (): Row => ({ description: '', quantity: '1', unit: 'st', price: '', vat: '25', account: String(salesAcc(25)) });
  const [rows, setRows] = useState<Row[]>(initial.lines?.length ? initial.lines : [blank()]);
  const [rr, setRr] = useState<string>(initial.reduction_type ?? '');
  const [rrMax, setRrMax] = useState(initial.reduction_max != null ? (initial.reduction_max / 100).toFixed(2).replace('.', ',') : '');
  const set = (i: number, k: keyof Row, v: string | boolean) =>
    setRows((r) => r.map((x, j) => {
      if (j !== i) return x;
      const n = { ...x, [k]: v };
      if (k === 'vat') n.account = String(salesAcc(Number(v)));
      return n;
    }));
  const parsed = rows.map((r) => ({
    description: r.description, quantity: Number(r.quantity.replace(',', '.')) || 0, unit: r.unit,
    unitPrice: parseAmount(r.price) ?? 0, vatRate: Number(r.vat) as 0 | 6 | 12 | 25, account: Number(r.account), labor: !!r.labor,
  }));
  const t = computeInvoice(parsed, { reverseCharge: rc, roundToKrona: !foreign });
  const labour = rr ? labourInclVat(parsed, t, rc) : 0;
  const red = rr ? computeReduction(rr as ReductionType, labour, parseAmount(rrMax)) : null;
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="flash error">{state.error}</div>}
      <div className="card stack">
        <div className="row">
          <label style={{ flex: '2 1 260px' }}>Kund
            <select name="customer_id" value={customerId} onChange={(e) => {
              setCustomerId(e.target.value);
              const c = customers.find((x) => String(x.id) === e.target.value);
              if (!c) return;
              setCurrency(c.currency ?? 'SEK'); setLang(c.language ?? 'sv');
              // Rader med standardkontot byter till det som gäller för den nya kunden (t.ex. 3308 vid omvänd skattskyldighet)
              const newAcc = (v: number) => (c.construction_rc ? 3231 : defaultSalesAccount(v, c.reverse_charge));
              if (!advance) setRows((r) => r.map((x) => (x.account === String(salesAcc(Number(x.vat))) ? { ...x, account: String(newAcc(Number(x.vat))) } : x)));
            }} required>
              <option value="">Välj kund…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Fakturadatum<input type="date" name="invoice_date" defaultValue={initial.invoice_date} required /></label>
          <label>Förfallodatum (tomt = enligt villkor)<input type="date" name="due_date" defaultValue={initial.due_date} /></label>
        </div>
        <div className="row">
          <label style={{ flex: '0 0 120px' }}>Valuta<select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>{['SEK', 'EUR', 'USD', 'GBP', 'NOK', 'DKK'].map((v) => <option key={v}>{v}</option>)}</select></label>
          {foreign && <label style={{ flex: '0 0 200px' }}>Kurs (kr per {currency})<input name="exchange_rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" required placeholder="T.ex. 11,25" /></label>}
          <label style={{ flex: '0 0 140px' }}>Språk<select name="language" value={lang} onChange={(e) => setLang(e.target.value)}><option value="sv">Svenska</option><option value="en">Engelska</option></select></label>
          {foreign && <span className="small muted" style={{ alignSelf: 'end', flex: '1 1 260px' }}>Priserna anges i {currency}. Fakturan bokförs i kronor med kursen ovan (t.ex. Riksbankens kurs på fakturadagen); kursdifferensen vid betalningen bokförs på 3960/7960.</span>}
        </div>
        <div className="row">
          <label>Vår referens<input name="our_reference" defaultValue={initial.our_reference} /></label>
          <label>Er referens<input name="your_reference" defaultValue={initial.your_reference} /></label>
          <label>Leveransdatum/-period (tomt = fakturadatum)<input name="delivery_date" defaultValue={initial.delivery_date} placeholder="T.ex. 2026-05-01 – 2026-05-31" /></label>
        </div>
        {rc && <p className="small muted" style={{ margin: 0 }}>Kunden har omvänd skattskyldighet – ingen moms debiteras och texten "Omvänd betalningsskyldighet" skrivs på fakturan. <Help term="omvand_moms" /></p>}
      </div>
      <datalist id="sales-accounts">{accounts.filter((a) => a.number >= 3000 && a.number < 4000).map((a) => <option key={a.number} value={a.number}>{a.name}</option>)}</datalist>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Beskrivning</th><th style={{ width: 90 }}>Antal</th><th style={{ width: 80 }}>Enhet</th><th style={{ width: 130 }} className="num">À-pris</th><th style={{ width: 90 }}>Moms</th><th style={{ width: 100 }}>Konto</th><th className="num">Belopp</th>{rr && <th title="Arbetskostnad som ger ROT/RUT-avdrag">Arbete</th>}<th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input value={r.description} onChange={(e) => set(i, 'description', e.target.value)} /></td>
                <td><input value={r.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} inputMode="decimal" /></td>
                <td><input value={r.unit} onChange={(e) => set(i, 'unit', e.target.value)} /></td>
                <td><input value={r.price} onChange={(e) => set(i, 'price', e.target.value)} inputMode="decimal" style={{ textAlign: 'right' }} /></td>
                <td>
                  <select value={r.vat} onChange={(e) => set(i, 'vat', e.target.value)} disabled={rc}>
                    <option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option>
                  </select>
                </td>
                <td><input list="sales-accounts" value={r.account} onChange={(e) => set(i, 'account', e.target.value)} /></td>
                <td className="num">{formatAmount(t.lineNets[i] ?? 0)}</td>
                {rr && <td style={{ textAlign: 'center' }}><input type="checkbox" aria-label="Arbetskostnad" name={`labor_${i}`} checked={!!r.labor} onChange={(e) => set(i, 'labor', e.target.checked)} /></td>}
                <td><button type="button" className="link" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="secondary" onClick={() => setRows((x) => [...x, blank()])}>+ Rad</button></div>
      <div className="card" style={{ maxWidth: 360, marginLeft: 'auto' }}>
        <div className="row"><span>Netto</span><span className="num" style={{ textAlign: 'right' }}>{formatAmount(t.net)}</span></div>
        <div className="row"><span>Moms</span><span style={{ textAlign: 'right' }}>{formatAmount(t.vat)}</span></div>
        {t.rounding !== 0 && <div className="row"><span>Öresavrundning</span><span style={{ textAlign: 'right' }}>{formatAmount(t.rounding)}</span></div>}
        {red && <>
          <div className="row"><span>Totalt</span><span style={{ textAlign: 'right' }}>{formatAmount(t.total)}</span></div>
          <div className="row"><span>{REDUCTION[rr as ReductionType].label} ({REDUCTION[rr as ReductionType].pct} % av arbete {formatAmount(labour)})</span><span style={{ textAlign: 'right' }}>−{formatAmount(red.reduction)}</span></div>
        </>}
        <div className="row" style={{ fontWeight: 700 }}><span>Att betala{foreign ? ` ${currency}` : ''}</span><span style={{ textAlign: 'right' }}>{formatAmount(t.total - (red?.reduction ?? 0))}</span></div>
        {foreign && Number(rate.replace(',', '.')) > 0 && <div className="row small muted"><span>Bokförs som</span><span style={{ textAlign: 'right' }}>{formatAmount(Math.round(t.total * Number(rate.replace(',', '.'))))} kr</span></div>}
        {red?.capped && <p className="small muted" style={{ margin: 0 }}>Avdraget är begränsat av köparens återstående utrymme.</p>}
      </div>
      <label className="check">
        <input type="checkbox" name="advance" checked={advance} onChange={(e) => {
          const on = e.target.checked; setAdvance(on); if (on) setRr('');
          setRows((r) => r.map((x) => ({ ...x, account: String(on ? 2420 : defaultSalesAccount(Number(x.vat), rc)) })));
        }} />
        <span>Förskottsfaktura – bokförs mot 2420 Förskott från kunder och dras av på slutfakturan</span>
      </label>
      {!rc && !advance && !foreign && (
        <div className="card stack">
          <div className="row" style={{ alignItems: 'end' }}>
            <label style={{ flex: '0 0 220px' }}>Skattereduktion för kunden
              <select name="reduction_type" value={rr} onChange={(e) => setRr(e.target.value)}>
                <option value="">Ingen</option><option value="rot">ROT-avdrag (30 % av arbetet)</option><option value="rut">RUT-avdrag (50 % av arbetet)</option>
              </select>
            </label>
            {rr && <p className="small muted" style={{ margin: 0, flex: '1 1 300px' }}>Markera raderna med arbetskostnad (kolumnen Arbete). Material, resor och utrustning ger inget avdrag. Kunden betalar resten och du begär avdraget från Skatteverket när kunden har betalat.</p>}
          </div>
          {rr && <>
            <div className="row">
              <label>Köparens personnummer<input name="buyer_pnr" defaultValue={initial.buyer_pnr} required placeholder="ÅÅÅÅMMDD-NNNN" /></label>
              <label style={{ flex: '2 1 260px' }}>Typ av arbete<input name="work_type" defaultValue={initial.work_type} required placeholder={rr === 'rot' ? 'T.ex. Målning och tapetsering' : 'T.ex. Städning'} /></label>
              <label>Kvar av köparens tak (kr, valfritt)<input value={rrMax} onChange={(e) => setRrMax(e.target.value)} inputMode="decimal" placeholder={rr === 'rot' ? '50 000' : '75 000'} /></label>
            </div>
            {rr === 'rot' && (
              <div className="row">
                <label>Fastighetsbeteckning (småhus)<input name="property" defaultValue={initial.property} placeholder="T.ex. Stockholm Ekbacken 1:23" /></label>
                <label>eller BRF:s org.nr<input name="brf_orgnr" defaultValue={initial.brf_orgnr} /></label>
                <label>Lägenhetsnummer<input name="apartment_no" defaultValue={initial.apartment_no} placeholder="1101" /></label>
              </div>
            )}
            <input type="hidden" name="reduction_max" value={rrMax} />
          </>}
        </div>
      )}
      <label>Meddelande på fakturan<textarea name="notes" rows={2} defaultValue={initial.notes} /></label>
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <div><button disabled={pending}>{pending ? 'Sparar…' : 'Spara utkast'}</button></div>
    </form>
  );
}
