'use client';
import { useEffect, useState } from 'react';
import { clearShared, sharedFile } from '@/lib/client/outbox';
import { APP_NAME } from '@/lib/brand';

/** Förhandsvisning av filen som delades till appen */
export function SharedPreview() {
  const [f, setF] = useState<{ name: string; url: string; type: string } | null | undefined>(undefined);
  useEffect(() => {
    sharedFile().then((s) => setF(s ? { name: s.name, url: URL.createObjectURL(s.file), type: s.file.type } : null)).catch(() => setF(null));
  }, []);
  if (f === undefined) return null;
  if (!f) return <p className="muted">Ingen delad fil hittades. Dela en bild eller PDF från bildgalleriet eller en annan app och välj {APP_NAME}.</p>;
  return (
    <div className="card shared-preview">
      {f.type.startsWith('image/') ? <img src={f.url} alt={f.name} /> : <div>📄 {f.name}</div>}
      <div className="small muted">{f.name}</div>
    </div>
  );
}

/** Lägger den delade filen i filfältet (och startar avläsningen) när sidan öppnas med ?delad=1 */
export function UseSharedFile({ input }: { input: string }) {
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('delad')) return;
    (async () => {
      const s = await sharedFile();
      const el = document.querySelector<HTMLInputElement>(`input[type=file][name="${input}"]`);
      if (!s || !el) return;
      const dt = new DataTransfer();
      dt.items.add(new File([s.file], s.name, { type: s.file.type }));
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await clearShared();
    })().catch(() => {});
  }, [input]);
  return null;
}
