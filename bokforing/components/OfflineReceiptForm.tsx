'use client';
import { useEffect, useState } from 'react';
import { RECEIPT_CATEGORIES } from '@/lib/receipts';
import { queueReceipt, queuedReceipts } from '@/lib/client/outbox';

/** Kvittoformulär som fungerar helt utan uppkoppling: sparar i telefonen och skickas sedan automatiskt */
export function OfflineReceiptForm() {
  const [cid, setCid] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const m = /\/c\/(\d+)\//.exec(location.pathname);
    const c = m ? Number(m[1]) : Number(new URLSearchParams(location.search).get('c')) || null;
    setCid(c);
    if (c) queuedReceipts(c).then((x) => setCount(x.length)).catch(() => {});
  }, []);
  if (!cid) return <p>Öppna sidan Nytt kvitto i appen en gång när du har uppkoppling.</p>;
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const file = fd.get('file');
      const fields: Record<string, string> = {};
      for (const k of ['date', 'total', 'category', 'description', 'paid_with']) fields[k] = String(fd.get(k) ?? '');
      await queueReceipt({ cid, fields, file: file instanceof File && file.size ? file : undefined, fileName: file instanceof File ? file.name : undefined, created: new Date().toISOString() });
      setCount((await queuedReceipts(cid)).length);
      setSaved(true);
      e.currentTarget.reset();
    }}>
      <div className="flash ok">Du är utan uppkoppling. Kvittot sparas i telefonen och bokförs automatiskt när du är uppkopplad igen.</div>
      {saved && <div className="flash ok" role="status">Sparat i telefonen ✓ – {count} {count === 1 ? 'kvitto väntar' : 'kvitton väntar'}.</div>}
      <label className="card" style={{ textAlign: 'center', borderStyle: 'dashed' }}>📷 Fota kvittot<input type="file" name="file" accept="image/*,application/pdf" capture="environment" /></label>
      <div className="row">
        <label>Datum<input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
        <label>Belopp inkl. moms (kr)<input name="total" inputMode="decimal" required /></label>
      </div>
      <label>Vad gäller kvittot?<select name="category" required defaultValue=""><option value="" disabled>Välj…</option>{RECEIPT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.group}: {c.label}</option>)}</select></label>
      <label>Beskrivning<input name="description" placeholder="T.ex. butik eller vad du köpte" /></label>
      <label>Betalat med<select name="paid_with" defaultValue="company"><option value="company">Företagets konto/kort</option><option value="private">Privata pengar (utlägg)</option></select></label>
      <div><button>Spara kvittot</button></div>
    </form>
  );
}
