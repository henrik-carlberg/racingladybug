'use client';
import { useRef, useState } from 'react';

/**
 * Inventering med streckkodsläsare: läsaren skriver koden och trycker Enter. Varje skanning räknar upp
 * artikelns fält "Räknat" med ett (eller med antalet i fältet bredvid).
 */
export function Scanner({ products }: { products: { id: number; sku: string; barcode: string; name: string }[] }) {
  const [msg, setMsg] = useState('');
  const [qty, setQty] = useState('1');
  const ref = useRef<HTMLInputElement>(null);
  const scan = (code: string) => {
    const c = code.trim();
    if (!c) return;
    const p = products.find((x) => x.barcode && x.barcode === c) ?? products.find((x) => x.sku.toLowerCase() === c.toLowerCase());
    if (!p) { setMsg(`⚠️ Okänd kod ${c}`); return; }
    const field = document.querySelector<HTMLInputElement>(`input[name="counted_${p.id}"]`);
    if (!field) return;
    const add = Number(qty.replace(',', '.')) || 1;
    const next = (Number(field.value.replace(',', '.')) || 0) + add;
    field.value = String(next).replace('.', ',');
    setMsg(`✓ ${p.name}: ${String(next).replace('.', ',')}`);
  };
  return (
    <div className="card row scanner" style={{ alignItems: 'end' }}>
      <label style={{ flex: '2 1 240px' }}>Skanna streckkod eller skriv artikelnummer
        <input ref={ref} autoFocus inputMode="numeric" aria-describedby="scan-msg" onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); scan(e.currentTarget.value); e.currentTarget.value = ''; }
        }} />
      </label>
      <label style={{ flex: '0 0 100px' }}>Antal per skanning<input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" /></label>
      <span id="scan-msg" role="status" className="small" style={{ flex: '1 1 200px' }}>{msg}</span>
    </div>
  );
}
