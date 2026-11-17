'use client';
import { useActionState, useState } from 'react';
import { RECEIPT_CATEGORIES, receiptLines } from '@/lib/receipts';
import { formatAmount, parseAmount } from '@/lib/money';

type State = { error?: string } | undefined;

export function ReceiptForm({ action, today, companyType, accountNames }: {
  action: (s: State, fd: FormData) => Promise<State>;
  today: string;
  companyType: 'AB' | 'EF';
  accountNames: Record<number, string>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [catKey, setCatKey] = useState('');
  const [total, setTotal] = useState('');
  const [vat, setVat] = useState<string>('');
  const [persons, setPersons] = useState('1');
  const [paidWith, setPaidWith] = useState<'company' | 'private'>('company');
  const cat = RECEIPT_CATEGORIES.find((c) => c.key === catKey);
  const vatRate = (vat === '' ? cat?.vat ?? 25 : Number(vat)) as 0 | 6 | 12 | 25;
  const totalOre = parseAmount(total) ?? 0;
  const preview = cat && totalOre > 0 ? receiptLines({ category: cat, total: totalOre, vatRate, persons: Number(persons) || 1, paidWith, companyType }) : null;
  const groups = [...new Set(RECEIPT_CATEGORIES.map((c) => c.group))];
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="flash error">{state.error}</div>}
      <label className="card" style={{ cursor: 'pointer', textAlign: 'center', borderStyle: 'dashed' }}>
        <span style={{ fontSize: '1.1rem' }}>📷 Fota eller välj kvitto</span>
        <span className="small muted">Bild eller PDF sparas som underlag (krav enligt bokföringslagen)</span>
        <input type="file" name="file" accept="image/*,application/pdf" capture="environment" />
      </label>
      <div className="row">
        <label>Datum på kvittot<input type="date" name="date" defaultValue={today} required /></label>
        <label>Belopp inkl. moms (kr)<input name="total" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" required placeholder="0,00" /></label>
      </div>
      <div className="stack" style={{ gap: '.5rem' }}>
        <b>Vad gäller kvittot?</b>
        {groups.map((g) => (
          <div key={g}>
            <div className="small muted">{g}</div>
            <div className="actions" style={{ margin: '.25rem 0' }}>
              {RECEIPT_CATEGORIES.filter((c) => c.group === g).map((c) => (
                <button type="button" key={c.key} className={catKey === c.key ? '' : 'secondary'} onClick={() => { setCatKey(c.key); setVat(''); }}>{c.label}</button>
              ))}
            </div>
          </div>
        ))}
        <input type="hidden" name="category" value={catKey} />
        {cat?.help && <div className="small card" style={{ margin: 0 }}>ℹ️ {cat.help}</div>}
      </div>
      <div className="row">
        <label>Moms<select name="vat_rate" value={String(vatRate)} onChange={(e) => setVat(e.target.value)}>
          <option value="25">25 %</option><option value="12">12 % (livsmedel, restaurang, hotell)</option><option value="6">6 % (resor, böcker)</option><option value="0">0 % / ingen moms</option>
        </select></label>
        {cat?.representation && <label>Antal personer<input name="persons" type="number" min={1} value={persons} onChange={(e) => setPersons(e.target.value)} /></label>}
        <label>Betalat med<select name="paid_with" value={paidWith} onChange={(e) => setPaidWith(e.target.value as 'company' | 'private')}>
          <option value="company">Företagets konto/kort</option>
          <option value="private">Privata pengar (utlägg){companyType === 'AB' ? ' – bolaget är skyldigt dig' : ' – egen insättning'}</option>
        </select></label>
      </div>
      <label>Beskrivning (valfritt)<input name="description" placeholder={cat?.label ?? 'T.ex. Pennor och block'} /></label>
      {preview && (
        <div className="card small">
          <b>Bokförs så här:</b>
          <table style={{ marginTop: '.5rem' }}><tbody>
            {preview.lines.map((l, i) => (
              <tr key={i}><td>{l.account}</td><td>{accountNames[l.account] ?? ''}</td>
                <td className="num">{l.debit ? formatAmount(l.debit) : ''}</td><td className="num">{l.credit ? formatAmount(l.credit) : ''}</td></tr>
            ))}
          </tbody></table>
          {preview.deductibleVat < preview.vat && <div className="muted">Momsavdraget begränsas till {formatAmount(preview.deductibleVat)} kr (representation). Resten blir kostnad.</div>}
        </div>
      )}
      <div className="actions" style={{ margin: 0 }}>
        <button disabled={pending || !cat || totalOre <= 0}>{pending ? 'Bokför…' : 'Bokför kvitto'}</button>
        <button name="another" value="1" className="secondary" disabled={pending || !cat || totalOre <= 0}>Bokför och registrera nästa</button>
      </div>
    </form>
  );
}
