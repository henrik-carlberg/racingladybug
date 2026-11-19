'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { flushReceipts, queuedReceipts } from '@/lib/client/outbox';

/** Skickar kvitton som sparats i telefonen när uppkopplingen är tillbaka (finns i bolagets layout) */
export function ReceiptOutbox({ cid }: { cid: number }) {
  const [waiting, setWaiting] = useState(0);
  const [msg, setMsg] = useState('');
  const router = useRouter();
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const before = (await queuedReceipts(cid)).length;
        if (before && navigator.onLine) {
          const r = await flushReceipts(cid);
          if (r.sent) { setMsg(`${r.sent} ${r.sent === 1 ? 'kvitto' : 'kvitton'} från telefonen är bokförda`); router.refresh(); }
          if (r.failed.length) setMsg(`Kunde inte bokföras: ${r.failed.join('; ')}`);
        }
        setWaiting((await queuedReceipts(cid)).length);
      } catch { /* ingen lagring */ } finally { busy = false; }
    };
    void run();
    const onOnline = () => void run();
    window.addEventListener('online', onOnline);
    window.addEventListener('receipt-queued', onOnline);
    const t = setInterval(run, 30000);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('receipt-queued', onOnline); clearInterval(t); };
  }, [cid, router]);
  if (!waiting && !msg) return null;
  return (
    <div className="outbox no-print" role="status">
      {waiting > 0 && <span>📱 {waiting} {waiting === 1 ? 'kvitto väntar' : 'kvitton väntar'} på uppkoppling</span>}
      {msg && <span>{msg} <button type="button" className="link small" onClick={() => setMsg('')}>OK</button></span>}
    </div>
  );
}
