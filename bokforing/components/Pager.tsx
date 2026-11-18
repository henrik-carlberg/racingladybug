import Link from 'next/link';

export const PAGE_SIZE = 100;

/** Sidnummer från ?sida= (1-baserat) */
export const pageOf = (sp: Record<string, string | string[] | undefined>) => Math.max(1, Math.min(10000, Number(sp.sida) || 1));

/** Hämta en rad extra för att veta om det finns fler sidor */
export const pageSql = (page: number, size = PAGE_SIZE) => ({ limit: size + 1, offset: (page - 1) * size });

/** Bläddra mellan sidor; behåller övriga parametrar i adressen */
export function Pager({ base, sp, page, hasMore, size = PAGE_SIZE, count }: { base: string; sp: Record<string, string | string[] | undefined>; page: number; hasMore: boolean; size?: number; count: number }) {
  if (page === 1 && !hasMore) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== 'sida' && k !== 'ok' && k !== 'error' && typeof v === 'string') as [string, string][]);
    if (p > 1) q.set('sida', String(p));
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const from = (page - 1) * size + 1;
  return (
    <div className="actions pager" style={{ alignItems: 'center' }}>
      {page > 1 && <Link className="btn secondary" href={href(page - 1)}>← Föregående</Link>}
      <span className="small muted">Visar {from}–{from + count - 1}</span>
      {hasMore && <Link className="btn secondary" href={href(page + 1)}>Nästa →</Link>}
    </div>
  );
}
