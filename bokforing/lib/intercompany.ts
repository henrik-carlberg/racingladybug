// Koncerninterna flöden: speglade fakturor, avstämning av mellanhavanden och koncerninterna avgifter. Ren logik, öre.

export const normOrg = (s: string) => s.replace(/\D/g, '').slice(-10);

/** Mellanhavandet mellan två bolag: A:s fordran ska motsvara B:s skuld */
export function reconcilePair(o: { receivable: number; payable: number; tolerance?: number }) {
  const diff = o.receivable - o.payable;
  return { diff, ok: Math.abs(diff) <= (o.tolerance ?? 100) };
}

export const CHARGE_KINDS = {
  management_fee: { label: 'Management fee', account: 3990, vat: 25 as const },
  interest: { label: 'Koncernränta', account: 8240, vat: 0 as const },
} as const;
export type ChargeKind = keyof typeof CHARGE_KINDS;

/** Månadens belopp: fast avgift, eller ränta på lånet (årsränta/12) */
export function chargeAmount(o: { kind: ChargeKind; amount: number | null; principal: number | null; ratePct: number | null }) {
  if (o.kind === 'management_fee') return Math.max(0, Math.round(o.amount ?? 0));
  return Math.max(0, Math.round(((o.principal ?? 0) * (o.ratePct ?? 0)) / 100 / 12));
}

/** Perioder som ska faktureras: från månaden efter den senast fakturerade till och med innevarande månad */
export function duePeriods(last: string | null, start: string, current: string) {
  const out: string[] = [];
  let [y, m] = (last ?? prev(start)).split('-').map(Number);
  for (let i = 0; i < 24; i++) {
    m++; if (m > 12) { m = 1; y++; }
    const p = `${y}-${String(m).padStart(2, '0')}`;
    if (p > current) break;
    out.push(p);
  }
  return out;
}
const prev = (p: string) => { let [y, m] = p.split('-').map(Number); m--; if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
