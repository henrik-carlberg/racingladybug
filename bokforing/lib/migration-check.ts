// Kontroll efter flytt från ett annat program: jämför saldon i SIE-filen med bokföringen (ren logik)

export interface BalanceRow { account: number; name: string; expected: number; actual: number; diff: number }

/** Alla konton som har saldo i filen eller i bokföringen, med skillnaden (öre). Avvikelser först. */
export function compareBalances(expected: Record<number, number>, actual: Record<number, number>, names: Record<number, string> = {}): { rows: BalanceRow[]; ok: number; diffs: number } {
  const accounts = new Set([...Object.keys(expected), ...Object.keys(actual)].map(Number));
  const rows = [...accounts].map((a) => {
    const e = Math.round(expected[a] ?? 0), x = Math.round(actual[a] ?? 0);
    return { account: a, name: names[a] ?? '', expected: e, actual: x, diff: x - e };
  }).filter((r) => r.expected !== 0 || r.actual !== 0)
    .sort((a, b) => Number(b.diff !== 0) - Number(a.diff !== 0) || a.account - b.account);
  const diffs = rows.filter((r) => r.diff !== 0).length;
  return { rows, ok: rows.length - diffs, diffs };
}

/** Program man kan flytta från, med var exporten brukar finnas */
export const PROGRAMS: Record<string, { name: string; sie: string; registers: string; open: string }> = {
  fortnox: {
    name: 'Fortnox',
    sie: 'Bokföring → Export/import → Exportera SIE (välj SIE typ 4 och räkenskapsåret).',
    registers: 'Kunder och leverantörer: öppna registret, markera alla och välj Exportera (CSV/Excel).',
    open: 'Kundreskontra och leverantörsreskontra: lista obetalda fakturor och exportera till Excel/CSV.',
  },
  visma: {
    name: 'Visma eEkonomi / Visma Administration',
    sie: 'Bokföring → Exportera → SIE-fil typ 4 (i Visma Administration: Arkiv → Export → SIE).',
    registers: 'Försäljning → Kunder och Inköp → Leverantörer: exportera listan till Excel/CSV.',
    open: 'Kund- och leverantörsreskontra: skriv ut eller exportera obetalda fakturor per bokslutsdagen till Excel/CSV.',
  },
  bokio: {
    name: 'Bokio',
    sie: 'Inställningar → Exportera bokföring → SIE-fil.',
    registers: 'Kunder och leverantörer: exportera listan som CSV.',
    open: 'Obetalda kund- och leverantörsfakturor: exportera listan som CSV.',
  },
  annat: {
    name: 'Annat program eller Excel',
    sie: 'Nästan alla svenska bokföringsprogram kan exportera SIE typ 4. Leta efter Export eller SIE i menyn.',
    registers: 'Spara kund- och leverantörslistan som CSV (kolumner som Namn, Organisationsnummer, E-post).',
    open: 'Spara obetalda fakturor som CSV med fakturanummer, kund/leverantör, datum, förfallodatum och restbelopp.',
  },
};
