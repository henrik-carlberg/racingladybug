'use client';
import { useState } from 'react';
import { decodeCsv, KIND_LABEL, type ImportKind, type ImportPreview } from '@/lib/csv-import';

const FIELD_LABEL: Record<string, string> = {
  name: 'Namn', orgnr: 'Org.nr', vat_number: 'Momsnr', email: 'E-post', address: 'Adress', postal_code: 'Postnr', city: 'Ort', country: 'Land', payment_terms: 'Villkor (dagar)',
  bankgiro: 'Bankgiro', plusgiro: 'Plusgiro', bank_account: 'Bankkonto', default_account: 'Konto', sku: 'Artikelnr', unit: 'Enhet', sales_price: 'Pris', purchase_price: 'Inköpspris',
  vat_rate: 'Moms %', number: 'Fakturanr', customer: 'Kund', supplier: 'Leverantör', invoice_date: 'Fakturadatum', due_date: 'Förfallodatum', amount: 'Belopp', ocr: 'OCR', reference: 'Referens',
};
const MONEY = new Set(['sales_price', 'purchase_price', 'amount']);

export function CsvImport({ preview, commit, kinds }: {
  preview: (kind: ImportKind, text: string) => Promise<{ preview?: ImportPreview; error?: string }>;
  commit: (kind: ImportKind, text: string) => Promise<{ result?: { created: number; skipped: number; related: number }; error?: string }>;
  kinds: ImportKind[];
}) {
  const [kind, setKind] = useState<ImportKind>(kinds[0]);
  const [text, setText] = useState('');
  const [p, setP] = useState<ImportPreview | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const run = async (k: ImportKind, t: string) => {
    setBusy(true); setMsg({});
    const r = await preview(k, t);
    setBusy(false);
    if (r.error) { setP(null); setMsg({ error: r.error }); } else setP(r.preview!);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const t = decodeCsv(new Uint8Array(await f.arrayBuffer()));
    setText(t);
    await run(kind, t);
  };
  const save = async () => {
    setBusy(true);
    const r = await commit(kind, text);
    setBusy(false);
    if (r.error) setMsg({ error: r.error });
    else { setMsg({ ok: `Klart: ${r.result!.created} importerade, ${r.result!.skipped} fanns redan${r.result!.related ? `, ${r.result!.related} nya ${kind === 'customer_invoices' ? 'kunder' : 'leverantörer'}` : ''}.` }); setP(null); setText(''); }
  };
  const fields = p ? p.columns.filter((c) => c.field).map((c) => c.field!) : [];
  return (
    <div className="stack">
      {msg.error && <div className="flash error">{msg.error}</div>}
      {msg.ok && <div className="flash ok import-done">{msg.ok}</div>}
      <div className="card row" style={{ alignItems: 'end' }}>
        <label>Vad vill du importera?<select name="kind" value={kind} onChange={(e) => { const k = e.target.value as ImportKind; setKind(k); if (text) run(k, text); }}>
          {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select></label>
        <label style={{ flex: '2 1 280px' }}>CSV-fil (semikolon, komma eller tabb)<input type="file" name="file" accept=".csv,.txt,text/csv" onChange={(e) => onFile(e.target.files?.[0])} /></label>
      </div>
      {busy && <p className="muted">Läser…</p>}
      {p && (
        <div className="card stack">
          <div className="small">
            <b>Kolumner:</b> {p.columns.map((c, i) => <span key={i} className={c.field ? 'badge' : 'badge muted'} style={{ marginRight: '.25rem' }}>{c.header || '(tom)'}{c.field ? ` → ${FIELD_LABEL[c.field] ?? c.field}` : ' (används inte)'}</span>)}
          </div>
          {p.missing.length > 0 && <div className="flash error">Hittar inte kolumnerna: {p.missing.map((f) => FIELD_LABEL[f] ?? f).join(', ')}. Byt namn på rubrikerna i filen och försök igen.</div>}
          {p.errors.length > 0 && <div className="flash error">{p.errors.length} rader har fel:<ul>{p.errors.slice(0, 20).map((e, i) => <li key={i}>Rad {e.row}: {e.message}</li>)}</ul></div>}
          {p.rows.length > 0 && (
            <div className="table-wrap"><table className="import-preview">
              <thead><tr>{fields.map((f) => <th key={f} className={MONEY.has(f) ? 'num' : ''}>{FIELD_LABEL[f] ?? f}</th>)}</tr></thead>
              <tbody>{p.rows.slice(0, 50).map((r, i) => <tr key={i}>{fields.map((f) => <td key={f} className={MONEY.has(f) ? 'num' : ''}>{MONEY.has(f) && typeof r[f] === 'number' ? (Number(r[f]) / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 }) : String(r[f] ?? '')}</td>)}</tr>)}</tbody>
            </table></div>
          )}
          {p.rows.length > 50 && <p className="small muted">Visar 50 av {p.rows.length} rader.</p>}
          {!p.missing.length && !p.errors.length && p.rows.length > 0 && <div><button disabled={busy} onClick={save}>Importera {p.rows.length} rader</button></div>}
        </div>
      )}
    </div>
  );
}
