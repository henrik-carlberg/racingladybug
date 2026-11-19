import Link from 'next/link';
import { angleOf, itemStatus, moduleIndex, polar, sector, WHEEL_MODULES, type WheelItem, type WheelModule } from '@/lib/wheel';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const STATUS_LABEL: Record<string, string> = { done: 'klar', overdue: 'försenad', soon: 'inom två veckor', upcoming: 'kommande' };

/**
 * Årshjul (12 månader) eller månadshjul (månadens dagar). En ring per modul, en punkt per aktivitet.
 * Status visas med form och etikett, inte bara färg: klar = ifylld med bock, försenad = röd ring, kommande = ifylld.
 */
export function Wheel({ items, view, year, month, modules, today, base }: { items: WheelItem[]; view: 'year' | 'month'; year: number; month: number; modules: WheelModule[]; today: string; base: string }) {
  const S = 640, c = S / 2, rIn = 96, rOut = 262, band = 22;
  const rings = modules.length || 1, w = (rOut - rIn) / rings, gap = 2;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const segs = view === 'year' ? 12 : days;
  const segAngle = (i: number) => {
    if (view === 'month') return (i / days) * 2 * Math.PI;
    return angleOf(`${year}-${String(i + 1).padStart(2, '0')}-01`, 'year') - (0.5 / 365) * 2 * Math.PI;
  };
  const todayIn = view === 'year' ? today.startsWith(String(year)) : today.startsWith(`${year}-${String(month).padStart(2, '0')}`);
  const left = items.filter((i) => !i.done).length, late = items.filter((i) => itemStatus(i, today) === 'overdue').length;
  // Flera aktiviteter samma dag i samma ring läggs bredvid varandra radiellt
  const slot = new Map<string, number>();
  return (
    <figure className="wheel" aria-label={view === 'year' ? `Årshjul ${year}` : `Månadshjul ${MONTHS[month - 1]} ${year}`}>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-labelledby="wheel-title">
        <title id="wheel-title">{view === 'year' ? `Årshjul ${year}: ${items.length} aktiviteter, ${left} kvar, ${late} försenade` : `Månadshjul ${MONTHS[month - 1]} ${year}: ${items.length} aktiviteter`}</title>
        {Array.from({ length: segs }, (_, i) => {
          const a0 = segAngle(i), a1 = i === segs - 1 ? 2 * Math.PI : segAngle(i + 1);
          const mid = (a0 + a1) / 2, [lx, ly] = polar(c, c, rOut + band / 2 + 6, mid);
          const label = view === 'year' ? MONTHS[i] : String(i + 1);
          const href = view === 'year' ? `${base}&vy=manad&ar=${year}&manad=${i + 1}` : undefined;
          const seg = (
            <g key={i}>
              <path d={sector(c, c, rOut + 2, rOut + band, a0 + 0.004, a1 - 0.004)} className={`wheel-band ${i % 2 ? 'odd' : ''}`} />
              {(view === 'year' || days <= 31) && <text x={lx} y={ly} className="wheel-label" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: view === 'year' ? 14 : 10 }}>{label}</text>}
            </g>
          );
          return href ? <Link key={i} href={href} aria-label={`Visa ${MONTHS[i]} ${year}`}>{seg}</Link> : seg;
        })}
        {modules.map((m, k) => (
          <g key={m}>
            <circle cx={c} cy={c} r={rIn + k * w + w / 2} className="wheel-ring" style={{ strokeWidth: w - gap }} />
          </g>
        ))}
        {Array.from({ length: segs }, (_, i) => { const a = segAngle(i), [x0, y0] = polar(c, c, rIn, a), [x1, y1] = polar(c, c, rOut + band, a); return <line key={`l${i}`} x1={x0} y1={y0} x2={x1} y2={y1} className="wheel-grid" />; })}
        {todayIn && (() => { const a = angleOf(today, view), [x0, y0] = polar(c, c, rIn - 6, a), [x1, y1] = polar(c, c, rOut + band, a); return <line x1={x0} y1={y0} x2={x1} y2={y1} className="wheel-today"><title>I dag {today}</title></line>; })()}
        {items.map((it) => {
          const k = modules.indexOf(it.module);
          if (k < 0) return null;
          const id = `${it.date}|${it.module}`, n = slot.get(id) ?? 0; slot.set(id, n + 1);
          const r = rIn + k * w + Math.min(w - 8, 8 + n * 11), a = angleOf(it.date, view);
          const [x, y] = polar(c, c, r, a);
          const st = itemStatus(it, today);
          const dot = (
            <g className={`wheel-dot ${st}`} style={{ ['--dot' as string]: `var(--wheel-${moduleIndex(it.module) + 1})` }}>
              <title>{`${it.date} ${it.title} (${STATUS_LABEL[st]})`}</title>
              <circle cx={x} cy={y} r={6} />
              {st === 'done' && <path d={`M${x - 3} ${y} l2 2.5 l4 -5`} className="wheel-check" />}
            </g>
          );
          return it.href ? <a key={it.key} href={it.href}>{dot}</a> : <g key={it.key}>{dot}</g>;
        })}
        <text x={c} y={c - 14} textAnchor="middle" className="wheel-center">{view === 'year' ? year : `${MONTHS[month - 1]} ${year}`}</text>
        <text x={c} y={c + 10} textAnchor="middle" className="wheel-sub">{left} kvar</text>
        {late > 0 && <text x={c} y={c + 30} textAnchor="middle" className="wheel-sub late">{late} försenade</text>}
      </svg>
      <figcaption className="viz-legend">
        {modules.map((m) => <span key={m}><i style={{ background: `var(--wheel-${moduleIndex(m) + 1})` }} />{WHEEL_MODULES.find((x) => x.key === m)!.label} ({items.filter((i) => i.module === m).length})</span>)}
        <span className="small muted">Inre ring: {WHEEL_MODULES.find((x) => x.key === modules[0])?.label ?? ''} · ● kommande · ✓ klar · <b style={{ color: 'var(--danger)' }}>◉</b> försenad (röd kant)</span>
      </figcaption>
    </figure>
  );
}
