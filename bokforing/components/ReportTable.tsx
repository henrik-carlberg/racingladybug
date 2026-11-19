import { kr } from '@/lib/format';

type Row = { key: string; label: string; type: string; bold?: boolean; values: (number | null)[]; budget: (number | null)[] };
/** Rader vars rubrik slutar med % visas som procent, övriga som kronor */
const fmt = (label: string, v: number | null) => (v == null ? '–' : /%\s*$/.test(label) ? `${(Math.round(v * 10) / 10).toLocaleString('sv-SE')} %` : kr(Math.round(v)));

export function ReportTable({ columns, rows, budget }: { columns: string[]; rows: Row[]; budget: boolean }) {
  return (
    <div className="table-wrap">
      <table className="report-table">
        <thead><tr><th />{columns.map((c) => <th key={c} className="num">{c}</th>)}{budget && <><th className="num">Budget</th><th className="num">Avvikelse</th></>}</tr></thead>
        <tbody>{rows.map((r) => r.type === 'heading' ? (
          <tr key={r.key}><th colSpan={columns.length + (budget ? 3 : 1)} style={{ textAlign: 'left', paddingTop: '.8rem' }}>{r.label}</th></tr>
        ) : (
          <tr key={r.key} className={r.bold ? 'sum' : ''}>
            <td>{r.bold ? <b>{r.label}</b> : r.label}</td>
            {r.values.map((v, i) => <td key={i} className="num">{fmt(r.label, v)}</td>)}
            {budget && <><td className="num">{fmt(r.label, r.budget[0])}</td><td className="num">{r.budget[0] == null || r.values[0] == null ? '–' : fmt(r.label, r.values[0] - r.budget[0])}</td></>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
