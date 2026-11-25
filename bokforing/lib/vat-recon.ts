// Momsavstämning på verifikationsnivå: momssats mot konto, omvänd skattskyldighet och momsfri EU-försäljning.
// Saldo per rad = kredit − debet (positivt för intäkter och utgående moms).
import { monthEnd } from '@/lib/format';

export type Line = { account: number; amount: number };
export type Issue = { key: string; text: string };

const between = (n: number, a: number, b: number) => n >= a && n <= b;
const OUT: [number, (n: number) => boolean][] = [
  [25, (n) => between(n, 2610, 2613) || between(n, 2616, 2619)],
  [12, (n) => between(n, 2620, 2623) || between(n, 2626, 2629)],
  [6, (n) => between(n, 2630, 2633) || between(n, 2636, 2639)],
];
const SALES_RATE: Record<number, number> = { 3001: 25, 3002: 12, 3003: 6 };
const RC_OUT = [2614, 2624, 2634];
const isRcBase = (n: number) => between(n, 4515, 4517) || n === 4535 || between(n, 4415, 4417) || between(n, 4425, 4427);
const EXEMPT_SALES = [3105, 3106, 3108, 3305, 3308, 3231, 3232];
const krs = (o: number) => `${Math.round(o / 100).toLocaleString('sv-SE')} kr`;
const tol = (x: number) => Math.max(100, Math.abs(x) * 0.01);

export function checkVoucher(lines: Line[]): Issue[] {
  const s = (p: (n: number) => boolean) => lines.filter((l) => p(l.account)).reduce((a, l) => a + l.amount, 0);
  const issues: Issue[] = [];
  const outTotal = OUT.reduce((a, [, p]) => a + s(p), 0);
  for (const [rate, p] of OUT) {
    const base = s((n) => SALES_RATE[n] === rate), vat = s(p);
    if (base && !outTotal) issues.push({ key: 'no_vat', text: `Försäljning ${krs(base)} på konto för ${rate} % moms utan utgående moms` });
    else if (base && Math.abs(vat - base * rate / 100) > tol(base * rate / 100)) issues.push({ key: 'rate', text: `Utgående moms ${rate} % är ${krs(vat)} men försäljningen ${krs(base)} ger ${krs(Math.round(base * rate / 100))}` });
    else if (vat && !base && lines.some((l) => SALES_RATE[l.account])) issues.push({ key: 'rate', text: `Utgående moms ${rate} % (${krs(vat)}) bokad på försäljning med annan momssats` });
  }
  const exempt = s((n) => EXEMPT_SALES.includes(n));
  if (exempt && outTotal) issues.push({ key: 'exempt_vat', text: `Momsfri försäljning (${krs(exempt)}) har utgående moms ${krs(outTotal)}` });
  const rcBase = -s(isRcBase), rcVat = s((n) => RC_OUT.includes(n)), input = -s((n) => between(n, 2640, 2649));
  if (rcBase && !rcVat) issues.push({ key: 'rc_out', text: `Inköp med omvänd skattskyldighet ${krs(rcBase)} saknar utgående moms (2614/2624/2634)` });
  if (rcVat && !rcBase) issues.push({ key: 'rc_base', text: `Utgående moms vid omvänd skattskyldighet ${krs(rcVat)} saknar beskattningsunderlag (ruta 20–24)` });
  if (rcBase && s((n) => n === 2614) && Math.abs(s((n) => n === 2614) - rcBase * 0.25) > tol(rcBase * 0.25)) issues.push({ key: 'rc_rate', text: `Utgående moms på 2614 (${krs(s((n) => n === 2614))}) är inte 25 % av underlaget ${krs(rcBase)}` });
  if (rcVat && input < rcVat - tol(rcVat)) issues.push({ key: 'rc_in', text: `Ingående moms (${krs(input)}) är lägre än momsen vid omvänd skattskyldighet (${krs(rcVat)}) – avdraget saknas troligen` });
  return issues;
}

/** Bokförd EU-försäljning mot den periodiska sammanställningen (hela kronor) */
export function euCompare(ledger: { goods: number; services: number }, ps: { goods: number; services: number }) {
  const rows = [
    { label: 'Varor (3106/3108 mot PS varor)', ledger: Math.round(ledger.goods / 100), ps: ps.goods },
    { label: 'Tjänster (3308 mot PS tjänster)', ledger: Math.round(ledger.services / 100), ps: ps.services },
  ].map((r) => ({ ...r, diff: r.ledger - r.ps, ok: Math.abs(r.ledger - r.ps) <= 1 }));
  return rows;
}

export function defaultVatPeriod(kind: 'month' | 'quarter' | 'year', t: string) {
  const [y, m] = t.split('-').map(Number);
  if (kind === 'month') { const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y; const p = `${py}-${String(pm).padStart(2, '0')}`; return [`${p}-01`, monthEnd(p)]; }
  if (kind === 'quarter') {
    let q = Math.floor((m - 1) / 3) - 1, qy = y; if (q < 0) { q = 3; qy--; }
    const sm = q * 3 + 1;
    return [`${qy}-${String(sm).padStart(2, '0')}-01`, monthEnd(`${qy}-${String(sm + 2).padStart(2, '0')}`)];
  }
  return [`${y - 1}-01-01`, `${y - 1}-12-31`];
}
