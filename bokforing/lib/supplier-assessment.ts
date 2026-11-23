// Leverantörsbedömning.
export const CHECKS: Record<string, string> = { f_tax: 'F-skatt', vat: 'Momsregistrering', credit: 'Kreditupplysning', insurance: 'Ansvarsförsäkring', collective: 'Kollektivavtal', code_of_conduct: 'Uppförandekod' };
export type Level = 'low' | 'medium' | 'high';
export const LEVELS: Record<Level, string> = { low: 'Låg', medium: 'Medel', high: 'Hög' };
/** Kontroller som krävs per risknivå */
export const REQUIRED: Record<Level, string[]> = {
  low: ['f_tax', 'vat'],
  medium: ['f_tax', 'vat', 'credit', 'insurance'],
  high: ['f_tax', 'vat', 'credit', 'insurance', 'collective', 'code_of_conduct'],
};

export interface Check { kind: string; valid_until: string; ok: boolean; checked_on: string }
/** Status per krav: senaste kontrollen av varje slag ska vara godkänd och fortfarande gälla */
export function assess(level: Level, checks: Check[], today: string, soonDays = 30) {
  const soon = new Date(Date.parse(today) + soonDays * 864e5).toISOString().slice(0, 10);
  const rows = REQUIRED[level].map((kind) => {
    const latest = checks.filter((c) => c.kind === kind).sort((a, b) => b.checked_on.localeCompare(a.checked_on))[0];
    const state = !latest ? 'missing' : !latest.ok ? 'failed' : latest.valid_until < today ? 'expired' : latest.valid_until <= soon ? 'expiring' : 'ok';
    return { kind, label: CHECKS[kind], state, valid_until: latest?.valid_until ?? null };
  });
  const problems = rows.filter((r) => r.state === 'missing' || r.state === 'failed' || r.state === 'expired');
  return { rows, ok: !problems.length, problems: problems.map((p) => `${p.label} ${p.state === 'missing' ? 'saknas' : p.state === 'failed' ? 'ej godkänd' : 'har gått ut'}`) };
}

/** Beroende: leverantörens andel av inköpen */
export const dependency = (supplier: number, total: number) => (total > 0 ? Math.round(supplier / total * 1000) / 10 : 0);
