'use client';
// Kvitton som fotas utan uppkoppling sparas i telefonen (IndexedDB) och skickas när det finns täckning.

export interface QueuedReceipt { id?: number; cid: number; fields: Record<string, string>; file?: Blob; fileName?: string; created: string }
const DB = 'bokforing-outbox', STORE = 'receipts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const queueReceipt = (r: QueuedReceipt) => tx('readwrite', (s) => s.add(r));
export const queuedReceipts = (cid?: number) => tx<QueuedReceipt[]>('readonly', (s) => s.getAll()).then((all) => (cid ? all.filter((x) => x.cid === cid) : all));
export const removeQueued = (id: number) => tx('readwrite', (s) => s.delete(id));

/** Skickar köade kvitton för bolaget. Returnerar antal skickade och fel (kvittot ligger kvar vid nätverksfel). */
export async function flushReceipts(cid: number): Promise<{ sent: number; failed: string[] }> {
  let sent = 0;
  const failed: string[] = [];
  for (const r of await queuedReceipts(cid)) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(r.fields)) fd.set(k, v);
    if (r.file) fd.set('file', r.file, r.fileName || 'kvitto.jpg');
    try {
      const res = await fetch(`/c/${cid}/kvitto/ko`, { method: 'POST', body: fd });
      if (res.ok) { await removeQueued(r.id!); sent++; continue; }
      const msg = (await res.json().catch(() => ({}))).error ?? `Fel ${res.status}`;
      // Fel i uppgifterna (inte nätverket): kvittot tas bort ur kön men felet visas
      if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) { await removeQueued(r.id!); failed.push(`${r.fields.description || 'Kvitto'}: ${msg}`); }
      else break;
    } catch { break; }
  }
  return { sent, failed };
}
