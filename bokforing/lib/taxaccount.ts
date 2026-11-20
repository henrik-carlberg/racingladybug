// Skattekontot hos Skatteverket – tolkning av export och förslag på kontering (ren logik, testbar)
import { parseCsv } from './csv-import';
import { parseAmount } from './money';

export interface TaxRow { date: string; text: string; amount: number; balance: number | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-zåäö]/g, '');
const pick = (header: string[], names: string[]) => header.findIndex((h) => names.some((n) => norm(h).startsWith(n)));

/** Rader ur skattekontots export (CSV eller kopierad tabell). Belopp i öre: positivt = insättning/kredit på skattekontot. */
export function parseTaxAccount(text: string): TaxRow[] {
  const rows = parseCsv(text.replace(/\t/g, ';'));
  const hi = rows.findIndex((r) => r.some((c) => /datum/i.test(c)) && r.some((c) => /belopp/i.test(c)));
  if (hi < 0) throw new Error('Hittar inte kolumnerna Datum och Belopp – exportera transaktionerna från Skatteverkets e-tjänst Skattekonto');
  const h = rows[hi];
  const iDate = pick(h, ['bokföringsdag', 'bokforingsdag', 'datum']), iText = pick(h, ['transaktion', 'specifikation', 'text', 'beskrivning']);
  const iAmt = pick(h, ['belopp']), iBal = pick(h, ['saldo']);
  const out: TaxRow[] = [];
  for (const r of rows.slice(hi + 1)) {
    const d = (r[iDate] ?? '').trim();
    const m = d.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    const amt = parseAmount((r[iAmt] ?? '').replace(/\s/g, '').replace(/kr$/i, ''));
    if (!m || amt == null) continue;
    const bal = iBal >= 0 ? parseAmount((r[iBal] ?? '').replace(/\s/g, '').replace(/kr$/i, '')) : null;
    out.push({ date: `${m[1]}-${m[2]}-${m[3]}`, text: (r[iText] ?? '').trim().slice(0, 200), amount: amt, balance: bal });
  }
  return out;
}

/** Föreslaget motkonto mot 1630. 'bank' = betalning till/från banken som stäms av via bankavstämningen. */
export function suggestAccount(text: string, companyType: 'AB' | 'EF' | 'HB' | 'KB'): number | 'bank' | null {
  const t = text.toLowerCase();
  if (/inbetalning|utbetalning|återbetalning till/.test(t)) return 'bank';
  if (/moms/.test(t)) return 2650;
  if (/arbetsgivaravgift/.test(t)) return 2731;
  if (/avdragen skatt|källskatt|skatteavdrag/.test(t)) return 2710;
  if (/preliminärskatt|prel\. ?skatt|debiterad prel/.test(t)) return companyType === 'AB' ? 2518 : 2012;
  if (/intäktsränta/.test(t)) return 8314;
  if (/kostnadsränta/.test(t)) return 8423;
  if (/förseningsavgift|avgift/.test(t)) return 6992;
  if (/slutlig skatt|kvarskatt/.test(t)) return companyType === 'AB' ? 2518 : 2012;
  return null;
}
