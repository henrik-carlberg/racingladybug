// Diagram som inline-SVG (ritas på servern). Färger via CSS-variabler, så ljust och mörkt läge fungerar.
const W = 720, H = 240, L = 64, R = 12, T = 12, B = 28;
const krShort = (ore: number) => {
  const k = ore / 100;
  if (Math.abs(k) >= 1_000_000) return `${(k / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} mn`;
  if (Math.abs(k) >= 10_000) return `${Math.round(k / 1000).toLocaleString('sv-SE')} tkr`;
  return Math.round(k).toLocaleString('sv-SE');
};
const krFull = (ore: number) => `${Math.round(ore / 100).toLocaleString('sv-SE')} kr`;

/** Jämna skalsteg (1, 2, 5 × 10^n) */
function ticks(min: number, max: number, n = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v));
  return out;
}

/** Stapel med rundade hörn bara i datändan (4 px), förankrad i nollinjen */
function bar(x: number, w: number, y0: number, y1: number) {
  const top = Math.min(y0, y1), h = Math.abs(y1 - y0);
  if (h < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  if (y1 < y0) return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`;
  const bot = top + h;
  return `M${x},${y0}V${bot - r}Q${x},${bot} ${x + r},${bot}H${x + w - r}Q${x + w},${bot} ${x + w},${bot - r}V${y0}Z`;
}

function Axis({ ys, scale }: { ys: number[]; scale: (v: number) => number }) {
  return <>{ys.map((v) => (
    <g key={v}>
      <line className={v === 0 ? 'base' : 'grid'} x1={L} x2={W - R} y1={scale(v)} y2={scale(v)} />
      <text x={L - 6} y={scale(v) + 4} textAnchor="end">{krShort(v)}</text>
    </g>
  ))}</>;
}

export interface MonthRow { label: string; revenue: number; cost: number; result: number }

/** Intäkter och kostnader per månad (staplar) med resultatet som linje – samma skala i kronor */
export function MonthlyChart({ rows, title }: { rows: MonthRow[]; title: string }) {
  const vals = rows.flatMap((r) => [r.revenue, r.cost, r.result, 0]);
  const ys = ticks(Math.min(...vals), Math.max(...vals));
  const lo = ys[0], hi = ys[ys.length - 1];
  const sy = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  const band = (W - L - R) / rows.length, bw = Math.min(18, (band - 10) / 2);
  const cx = (i: number) => L + band * i + band / 2;
  const pts = rows.map((r, i) => `${cx(i)},${sy(r.result)}`).join(' ');
  return (
    <figure style={{ margin: 0 }}>
      <div className="viz-legend" aria-hidden="true"><span><i style={{ background: 'var(--series-1)' }} />Intäkter</span><span><i style={{ background: 'var(--series-2)' }} />Kostnader</span><span><i className="line" style={{ background: 'var(--series-3)' }} />Resultat</span></div>
      <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <Axis ys={ys} scale={sy} />
        {rows.map((r, i) => (
          <g key={r.label}>
            <path d={bar(cx(i) - bw - 1, bw, sy(0), sy(r.revenue))} fill="var(--series-1)" />
            <path d={bar(cx(i) + 1, bw, sy(0), sy(r.cost))} fill="var(--series-2)" />
            <text x={cx(i)} y={H - 8} textAnchor="middle">{r.label.slice(5)}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke="var(--series-3)" strokeWidth={2} strokeLinejoin="round" />
        {rows.map((r, i) => <circle key={i} cx={cx(i)} cy={sy(r.result)} r={4} fill="var(--series-3)" stroke="var(--panel)" strokeWidth={2} />)}
        {rows.map((r, i) => (
          <rect key={`h${i}`} className="hit" x={L + band * i} y={T} width={band} height={H - T - B}>
            <title>{`${r.label}\nIntäkter ${krFull(r.revenue)}\nKostnader ${krFull(r.cost)}\nResultat ${krFull(r.result)}`}</title>
          </rect>
        ))}
      </svg>
      <details className="small"><summary>Visa som tabell</summary>
        <table><thead><tr><th>Månad</th><th className="num">Intäkter</th><th className="num">Kostnader</th><th className="num">Resultat</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{krFull(r.revenue)}</td><td className="num">{krFull(r.cost)}</td><td className="num">{krFull(r.result)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

/** Kassa och bank vid månadens slut, med prognos som streckad fortsättning */
export function CashChart({ actual, forecast, title }: { actual: { label: string; value: number }[]; forecast: { label: string; value: number }[]; title: string }) {
  const all = [...actual, ...forecast];
  const ys = ticks(Math.min(0, ...all.map((p) => p.value)), Math.max(...all.map((p) => p.value), 1));
  const lo = ys[0], hi = ys[ys.length - 1];
  const sy = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  const step = (W - L - R) / Math.max(1, all.length - 1);
  const x = (i: number) => L + step * i;
  const path = (list: { value: number }[], off: number) => list.map((p, i) => `${x(i + off)},${sy(p.value)}`).join(' ');
  const last = actual.length - 1;
  return (
    <figure style={{ margin: 0 }}>
      <div className="viz-legend" aria-hidden="true"><span><i className="line" style={{ background: 'var(--series-1)' }} />Kassa och bank</span>{forecast.length > 0 && <span><i className="dash" />Prognos</span>}</div>
      <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <Axis ys={ys} scale={sy} />
        {all.map((p, i) => (i % 2 === 0 || i === all.length - 1) && <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle">{p.label.slice(2)}</text>)}
        <polyline points={path(actual, 0)} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {forecast.length > 0 && <polyline points={`${x(last)},${sy(actual[last].value)} ${path(forecast, actual.length)}`} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" />}
        <circle cx={x(last)} cy={sy(actual[last].value)} r={4} fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} />
        <text x={x(last) - 8} y={sy(actual[last].value) - 8} textAnchor="end" style={{ fill: 'var(--text)' }}>{krShort(actual[last].value)}</text>
        {all.map((p, i) => (
          <rect key={`h${i}`} className="hit" x={x(i) - step / 2} y={T} width={step} height={H - T - B}>
            <title>{`${p.label}${i >= actual.length ? ' (prognos)' : ''}\n${krFull(p.value)}`}</title>
          </rect>
        ))}
      </svg>
      <details className="small"><summary>Visa som tabell</summary>
        <table><tbody>{all.map((p, i) => <tr key={p.label}><td>{p.label}{i >= actual.length ? ' (prognos)' : ''}</td><td className="num">{krFull(p.value)}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

/** Fördelning (en serie), t.ex. antal fakturor per betaltid */
export function Histogram({ bins, title, unit }: { bins: { label: string; count: number }[]; title: string; unit: string }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  const ys = ticks(0, max).filter((v) => Number.isInteger(v));
  const hi = ys[ys.length - 1];
  const sy = (v: number) => T + ((hi - v) / (hi || 1)) * (H - T - B);
  const band = (W - L - R) / bins.length, bw = Math.min(56, band - 12);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="viz" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ys.map((v) => <g key={v}><line className={v === 0 ? 'base' : 'grid'} x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} /><text x={L - 6} y={sy(v) + 4} textAnchor="end">{v}</text></g>)}
        {bins.map((b, i) => {
          const x = L + band * i + (band - bw) / 2;
          return (
            <g key={b.label}>
              <path d={bar(x, bw, sy(0), sy(b.count))} fill="var(--series-1)" />
              {b.count > 0 && <text x={x + bw / 2} y={sy(b.count) - 6} textAnchor="middle" style={{ fill: 'var(--text)' }}>{b.count}</text>}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle">{b.label}</text>
              <rect className="hit" x={L + band * i} y={T} width={band} height={H - T - B}><title>{`${b.label} ${unit}: ${b.count}`}</title></rect>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
