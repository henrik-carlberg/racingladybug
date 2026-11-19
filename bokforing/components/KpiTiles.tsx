import { kr } from '@/lib/format';
import { KPI_LABEL, PCT_KPIS, type Kpis } from '@/lib/report-builder';

const show = (k: keyof Kpis, v: number | null) => (v == null ? '–' : PCT_KPIS.includes(k) ? `${v.toLocaleString('sv-SE')} %` : k === 'dso' ? `${v} dagar` : kr(v));
/** Nyckeltal som rutor med jämförelse mot samma period i fjol (pil och text, inte bara färg) */
export function KpiTiles({ keys, now, prev }: { keys: (keyof Kpis)[]; now: Kpis; prev: Kpis }) {
  return (
    <div className="grid kpi-tiles">
      {keys.map((k) => {
        const a = now[k], b = prev[k];
        const diff = a != null && b != null ? a - b : null;
        // Lägre är bättre för betaltid och kortfristiga skulder
        const better = diff == null || diff === 0 ? null : (k === 'dso' || k === 'currentLiabilities') ? diff < 0 : diff > 0;
        return (
          <div key={k} className="card stat kpi" data-kpi={k}>
            <div className="label">{KPI_LABEL[k]}</div>
            <div className="value">{show(k, a)}</div>
            <div className={`small ${better == null ? 'muted' : better ? 'ok-text' : 'danger-text'}`}>{diff == null ? 'ingen jämförelse' : `${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${PCT_KPIS.includes(k) ? `${(Math.round(Math.abs(diff) * 10) / 10).toLocaleString('sv-SE')} procentenheter` : show(k, Math.abs(diff))} mot i fjol (${show(k, b)})`}</div>
          </div>
        );
      })}
    </div>
  );
}
