// Säljpipeline: prognos och analys utan databas. Belopp i öre.

export const DEFAULT_STAGES: { name: string; probability: number; kind: 'open' | 'won' | 'lost' }[] = [
  { name: 'Ny möjlighet', probability: 10, kind: 'open' },
  { name: 'Behovsanalys', probability: 25, kind: 'open' },
  { name: 'Offert skickad', probability: 50, kind: 'open' },
  { name: 'Förhandling', probability: 75, kind: 'open' },
  { name: 'Vunnen', probability: 100, kind: 'won' },
  { name: 'Förlorad', probability: 0, kind: 'lost' },
];

export const LOST_REASONS = ['Pris', 'Valde konkurrent', 'Ingen budget', 'Fel tidpunkt', 'Inget beslut', 'Behovet försvann', 'Annat'];

export const weighted = (value: number, probability: number) => Math.round((value * probability) / 100);

export interface DealLite { value: number; probability: number; kind: 'open' | 'won' | 'lost'; expected_close: string | null; created: string; closed_at: string | null; lost_reason: string; owner: string | null }

/** Viktad prognos per månad för öppna affärer (affärer utan datum eller med passerat datum hamnar i första månaden) */
export function forecast(deals: DealLite[], fromMonth: string, months = 6) {
  const out: { month: string; value: number; weighted: number; count: number }[] = [];
  let y = Number(fromMonth.slice(0, 4)), m = Number(fromMonth.slice(5, 7));
  for (let i = 0; i < months; i++) {
    out.push({ month: `${y}-${String(m).padStart(2, '0')}`, value: 0, weighted: 0, count: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  for (const d of deals.filter((x) => x.kind === 'open')) {
    const key = !d.expected_close || d.expected_close.slice(0, 7) < fromMonth ? fromMonth : d.expected_close.slice(0, 7);
    const slot = out.find((o) => o.month === key);
    if (!slot) continue;
    slot.value += d.value; slot.weighted += weighted(d.value, d.probability); slot.count++;
  }
  return out;
}

/** Vinstandel, snittaffär, säljcykel och förlustorsaker för avslutade affärer */
export function analysis(deals: DealLite[]) {
  const won = deals.filter((d) => d.kind === 'won'), lost = deals.filter((d) => d.kind === 'lost');
  const closed = won.length + lost.length;
  const days = (d: DealLite) => (d.closed_at ? Math.max(0, Math.round((Date.parse(d.closed_at) - Date.parse(d.created)) / 86400000)) : 0);
  const reasons = new Map<string, number>();
  for (const d of lost) reasons.set(d.lost_reason || 'Ej angiven', (reasons.get(d.lost_reason || 'Ej angiven') ?? 0) + 1);
  const owners = new Map<string, { won: number; lost: number; value: number }>();
  for (const d of [...won, ...lost]) {
    const o = owners.get(d.owner ?? 'Ingen') ?? { won: 0, lost: 0, value: 0 };
    if (d.kind === 'won') { o.won++; o.value += d.value; } else o.lost++;
    owners.set(d.owner ?? 'Ingen', o);
  }
  return {
    won: won.length, lost: lost.length, winRate: closed ? Math.round((won.length / closed) * 1000) / 10 : null,
    wonValue: won.reduce((s, d) => s + d.value, 0), avgDeal: won.length ? Math.round(won.reduce((s, d) => s + d.value, 0) / won.length) : null,
    avgCycleDays: won.length ? Math.round(won.reduce((s, d) => s + days(d), 0) / won.length) : null,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
    owners: [...owners.entries()].map(([owner, o]) => ({ owner, ...o, winRate: Math.round((o.won / (o.won + o.lost)) * 1000) / 10 })).sort((a, b) => b.value - a.value),
  };
}
