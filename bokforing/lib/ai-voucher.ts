// Kontroll av verifikationsförslag från AI (ren logik). Förslaget används bara om det går ihop.

export interface RawLine { account: number; debit: number; credit: number; description?: string | null }
export interface VoucherSuggestion { date: string; description: string; lines: { account: number; debit: number; credit: number; description: string }[]; explanation: string; confidence: 'high' | 'medium' | 'low'; problems: string[] }

/** Belopp i kronor från AI → öre; kontrollerar konton, balans och rimlighet */
export function validateSuggestion(raw: { date?: string | null; description?: string | null; lines?: RawLine[]; explanation?: string | null; confidence?: string | null }, accounts: Set<number>, today: string): VoucherSuggestion {
  const problems: string[] = [];
  const lines = (raw.lines ?? []).slice(0, 12).map((l) => ({
    account: Math.trunc(Number(l.account)), debit: Math.round(Math.max(0, Number(l.debit) || 0) * 100), credit: Math.round(Math.max(0, Number(l.credit) || 0) * 100), description: String(l.description ?? '').slice(0, 200),
  })).filter((l) => l.debit > 0 || l.credit > 0);
  for (const l of lines) {
    if (!(l.account >= 1000 && l.account <= 8999)) problems.push(`Konto ${l.account} finns inte i BAS-kontoplanen`);
    else if (!accounts.has(l.account)) problems.push(`Konto ${l.account} finns inte i bolagets kontoplan`);
    if (l.debit > 0 && l.credit > 0) problems.push(`Konto ${l.account} har både debet och kredit på samma rad`);
  }
  const d = lines.reduce((s, l) => s + l.debit, 0), c = lines.reduce((s, l) => s + l.credit, 0);
  if (lines.length < 2) problems.push('Förslaget har färre än två rader');
  else if (d !== c) problems.push(`Debet (${(d / 100).toFixed(2)}) och kredit (${(c / 100).toFixed(2)}) är inte lika`);
  const date = raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && !Number.isNaN(Date.parse(raw.date)) ? raw.date : today;
  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low';
  return { date, description: String(raw.description ?? '').trim().slice(0, 200) || 'Verifikation', lines, explanation: String(raw.explanation ?? '').slice(0, 600), confidence, problems };
}

// ---- Avvikelser per månad ----
export interface Anomaly { kind: 'high' | 'missing'; account: number; name: string; month: string; amount: number; usual: number }

/**
 * Kostnadskonton (4000–7999): ovanligt hög kostnad (mer än 2,5 gånger snittet de sex månaderna före och minst 2 000 kr mer),
 * och kostnader som brukar komma varje månad (de tre senaste) men saknas.
 * monthly: konto → månad (YYYY-MM) → belopp (öre, debet − kredit)
 */
export function findAnomalies(monthly: Map<number, Map<string, number>>, month: string, names: Map<number, string>): Anomaly[] {
  const prev = (m: string, n: number) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 - n, 1)); return d.toISOString().slice(0, 7); };
  const out: Anomaly[] = [];
  for (const [acc, byMonth] of monthly) {
    if (acc < 4000 || acc > 7999) continue;
    const cur = byMonth.get(month) ?? 0;
    const hist = [1, 2, 3, 4, 5, 6].map((n) => byMonth.get(prev(month, n)) ?? 0);
    const active = hist.filter((v) => v > 0);
    const avg = active.length >= 3 ? active.reduce((s, v) => s + v, 0) / active.length : 0;
    if (avg > 0 && cur > 2.5 * avg && cur - avg >= 200_000) out.push({ kind: 'high', account: acc, name: names.get(acc) ?? '', month, amount: cur, usual: Math.round(avg) });
    if (hist.slice(0, 3).every((v) => v > 0) && cur === 0) out.push({ kind: 'missing', account: acc, name: names.get(acc) ?? '', month, amount: 0, usual: Math.round(hist.slice(0, 3).reduce((s, v) => s + v, 0) / 3) });
  }
  return out.sort((a, b) => (b.amount - b.usual) - (a.amount - a.usual)).slice(0, 6);
}
