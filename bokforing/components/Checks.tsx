import type { Check } from '@/lib/checks';

const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' } as const;

/** Visar kontrollerna under ett formulär. Fel stoppar bokföringen, varningar och tips gör det inte. */
export function Checks({ items }: { items: Check[] }) {
  if (!items.length) return null;
  return (
    <div className="checks" role="status" aria-live="polite">
      {items.map((c) => <div key={c.text} className={`check-item ${c.level}`}><span aria-hidden="true">{ICON[c.level]}</span><span>{c.text}</span></div>)}
    </div>
  );
}
