// Styrelsepaket. Belopp i öre.
export type PackageData = {
  company: string; from: string; to: string;
  result: { revenue: number; costs: number; result: number; budgetRevenue: number; budgetCosts: number; budgetResult: number };
  cash: number; kpis: { label: string; value: string }[]; alerts: string[];
  decisions: { title: string; decision: string; owner: string; due: string | null; overdue: boolean }[];
  control: { missing: number; deviations: string[] }; risks: { area: string; description: string; score: number }[];
};
export const variance = (actual: number, budget: number) => ({ diff: actual - budget, pct: budget ? Math.round((actual - budget) / Math.abs(budget) * 1000) / 10 : null });
/** Perioden: en månad eller ett kvartal som slutar med föregående avslutade månad */
export function period(kind: 'month' | 'quarter', today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1; // föregående månad (0-baserat index + 1)
  const endY = m === 0 ? y - 1 : y, endM = m === 0 ? 12 : m;
  const startM = kind === 'month' ? endM : endM - 2, startY = startM < 1 ? endY - 1 : endY;
  const sm = startM < 1 ? startM + 12 : startM;
  const last = new Date(Date.UTC(endY, endM, 0)).getUTCDate();
  return { from: `${startY}-${String(sm).padStart(2, '0')}-01`, to: `${endY}-${String(endM).padStart(2, '0')}-${last}` };
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function packageHtml(d: PackageData, fmt: (n: number) => string, comment: string) {
  const v = (a: number, b: number) => { const x = variance(a, b); return `${fmt(x.diff)}${x.pct != null ? ` (${x.pct.toLocaleString('sv-SE')} %)` : ''}`; };
  return `<h1>Styrelsepaket ${esc(d.company)}</h1><p>${esc(d.from)} – ${esc(d.to)}</p>${comment ? `<p><b>VD:s kommentar:</b> ${esc(comment)}</p>` : ''}
<h2>Resultat mot budget</h2><table><tr><th></th><th>Utfall</th><th>Budget</th><th>Avvikelse</th></tr>
<tr><td>Intäkter</td><td>${fmt(d.result.revenue)}</td><td>${fmt(d.result.budgetRevenue)}</td><td>${v(d.result.revenue, d.result.budgetRevenue)}</td></tr>
<tr><td>Kostnader</td><td>${fmt(d.result.costs)}</td><td>${fmt(d.result.budgetCosts)}</td><td>${v(d.result.costs, d.result.budgetCosts)}</td></tr>
<tr><td><b>Resultat</b></td><td><b>${fmt(d.result.result)}</b></td><td>${fmt(d.result.budgetResult)}</td><td>${v(d.result.result, d.result.budgetResult)}</td></tr></table>
<p><b>Kassa och bank:</b> ${fmt(d.cash)} kr</p>
<h2>Nyckeltal</h2><ul>${d.kpis.map((k) => `<li>${esc(k.label)}: ${esc(k.value)}</li>`).join('')}</ul>${d.alerts.length ? `<p><b>Larm:</b> ${d.alerts.map(esc).join('; ')}</p>` : ''}
<h2>Beslut att följa upp</h2>${d.decisions.length ? `<ul>${d.decisions.map((x) => `<li>${esc(x.title)}: ${esc(x.decision)}${x.owner ? ` – ${esc(x.owner)}` : ''}${x.due ? `, senast ${esc(x.due)}${x.overdue ? ' (försenat)' : ''}` : ''}</li>`).join('')}</ul>` : '<p>Inga öppna beslut.</p>'}
<h2>Internkontroll och risker</h2><p>${d.control.missing} kontroller saknas för senaste perioden.</p>${d.control.deviations.length ? `<ul>${d.control.deviations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
${d.risks.length ? `<ul>${d.risks.map((r) => `<li>${esc(r.area)}: ${esc(r.description)} (riskvärde ${r.score})</li>`).join('')}</ul>` : '<p>Inga höga risker.</p>'}`;
}
