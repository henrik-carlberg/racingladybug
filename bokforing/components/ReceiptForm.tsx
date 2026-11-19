'use client';
import { useActionState, useState } from 'react';
import { RECEIPT_CATEGORIES, receiptLines, type ReceiptGuess } from '@/lib/receipts';
import { formatAmount, parseAmount } from '@/lib/money';
import { receiptKey, type ReceiptCoding } from '@/lib/coding-memory';
import { dateChecks, type Period } from '@/lib/checks';
import { Checks } from './Checks';

type State = { error?: string } | undefined;

export function ReceiptForm({ action, read, today, companyType, accountNames, learned = {}, period }: {
  learned?: Record<string, ReceiptCoding & { streak: number }>;
  period?: Period;
  action: (s: State, fd: FormData) => Promise<State>;
  read?: (fd: FormData) => Promise<{ guess?: ReceiptGuess; error?: string }>;
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
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [reading, setReading] = useState<'' | 'busy' | 'done' | string>('');
  const [picked, setPicked] = useState(false);
  const [applied, setApplied] = useState<(ReceiptCoding & { streak: number }) | null>(null);
  /** Samma butik som de senaste gångerna → samma kategori, moms och betalsätt (om användaren inte själv har valt) */
  const learn = (desc: string, force = false) => {
    const l = learned[receiptKey(desc)];
    if (!l || (picked && !force)) { if (!l) setApplied(null); return; }
    setCatKey(l.category); setVat(String(l.vatRate)); setPaidWith(l.paidWith); setApplied(l);
  };
  const onFile = async (f: File | undefined) => {
    if (!read || !f) return;
    setReading('busy');
    const fd = new FormData();
    fd.set('file', f);
    try {
      const r = await read(fd);
      if (r.error || !r.guess) { setReading(r.error ?? 'Kvittot kunde inte läsas av'); return; }
      const g = r.guess;
      if (g.date) setDate(g.date);
      if (g.total) setTotal((g.total / 100).toFixed(2).replace('.', ','));
      if (g.category) setCatKey(g.category);
      setVat(g.vatRate != null ? String(g.vatRate) : '');
      if (g.description || g.merchant) { const d = [g.merchant, g.description].filter(Boolean).join(': '); setDescription(d); learn(d, true); }
      setReading('done');
    } catch { setReading('Kvittot kunde inte läsas av'); }
  };
  const cat = RECEIPT_CATEGORIES.find((c) => c.key === catKey);
  const vatRate = (vat === '' ? cat?.vat ?? 25 : Number(vat)) as 0 | 6 | 12 | 25;
  const totalOre = parseAmount(total) ?? 0;
  const preview = cat && totalOre > 0 ? receiptLines({ category: cat, total: totalOre, vatRate, persons: Number(persons) || 1, paidWith, companyType }) : null;
  const checks = period ? dateChecks(date, period, today) : [];
  const blocked = checks.some((c) => c.level === 'error');
  const groups = [...new Set(RECEIPT_CATEGORIES.map((c) => c.group))];
  return (
    <form action={formAction} className="stack">
      {state?.error && <div className="flash error">{state.error}</div>}
      <label className="card" style={{ cursor: 'pointer', textAlign: 'center', borderStyle: 'dashed' }}>
        <span style={{ fontSize: '1.1rem' }}>📷 Fota eller välj kvitto</span>
        <span className="small muted">Bild eller PDF sparas som underlag (krav enligt bokföringslagen)</span>
        <input type="file" name="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} />
        {read && reading === '' && <span className="small muted">Uppgifterna läses av automatiskt – kontrollera dem innan du bokför.</span>}
        {reading === 'busy' && <span className="small">Läser av kvittot…</span>}
        {reading === 'done' && <span className="small receipt-read" style={{ color: 'var(--ok)' }}>Avläst ✓ Kontrollera uppgifterna nedan.</span>}
        {reading && reading !== 'busy' && reading !== 'done' && <span className="small" style={{ color: 'var(--warn)' }}>{reading}</span>}
      </label>
      <div className="row">
        <label>Datum på kvittot<input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Belopp inkl. moms (kr)<input name="total" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" required placeholder="0,00" /></label>
      </div>
      <div className="stack" style={{ gap: '.5rem' }}>
        <b>Vad gäller kvittot?</b>
        {groups.map((g) => (
          <div key={g}>
            <div className="small muted">{g}</div>
            <div className="actions" style={{ margin: '.25rem 0' }}>
              {RECEIPT_CATEGORIES.filter((c) => c.group === g).map((c) => (
                <button type="button" key={c.key} className={catKey === c.key ? '' : 'secondary'} onClick={() => { setCatKey(c.key); setVat(''); setPicked(true); setApplied(null); }}>{c.label}</button>
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
      <label>Beskrivning (valfritt)<input name="description" value={description} onChange={(e) => { setDescription(e.target.value); learn(e.target.value); }} placeholder={cat?.label ?? 'T.ex. Pennor och block'} /></label>
      {applied && <div className="learned small" role="status">✨ Ifyllt som de {applied.streak} senaste kvittona från samma ställe: {RECEIPT_CATEGORIES.find((c) => c.key === applied.category)?.label}, {applied.vatRate} % moms. Ändra om det inte stämmer.</div>}
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
      <Checks items={checks} />
      <div className="actions" style={{ margin: 0 }}>
        <button disabled={pending || reading === 'busy' || !cat || totalOre <= 0 || blocked}>{pending ? 'Bokför…' : 'Bokför kvitto'}</button>
        <button name="another" value="1" className="secondary" disabled={pending || !cat || totalOre <= 0 || blocked}>Bokför och registrera nästa</button>
      </div>
    </form>
  );
}
