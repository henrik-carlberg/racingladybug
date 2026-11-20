// Leasing (ren logik): klassning enligt K3 kap. 20, nuvärde, betalningsplan, bokningsrader och framtida avgifter per förfallotid. Belopp i öre.
export type LeaseKind = 'car' | 'machine' | 'it' | 'premises' | 'other';
export const KIND_LABEL: Record<LeaseKind, string> = { car: 'Personbil', machine: 'Maskin', it: 'Datorer och IT', premises: 'Lokal', other: 'Övrigt' };
export const COST_ACCOUNT: Record<LeaseKind, number> = { car: 5615, machine: 5220, it: 5220, premises: 5010, other: 5220 };
export const ASSET_ACCOUNT: Record<LeaseKind, number> = { car: 1240, machine: 1210, it: 1250, premises: 1220, other: 1220 };
export const LEASE_DEBT = 2355;   // Leasingskuld (finansiell leasing)
export const INTEREST = 8410;
export const INPUT_VAT = 2641;

/** Månadsräntan ur årsräntan (effektiv) */
export const monthlyRate = (annualPct: number) => (annualPct > 0 ? Math.pow(1 + annualPct / 100, 1 / 12) - 1 : 0);

/** Nuvärdet av leasingavgifterna och restvärdet (som sista betalning) */
export function presentValue(o: { fee: number; months: number; ratePct: number; residual: number }) {
  const r = monthlyRate(o.ratePct);
  if (!r) return o.fee * o.months + o.residual;
  let pv = 0;
  for (let t = 1; t <= o.months; t++) pv += o.fee / Math.pow(1 + r, t);
  return Math.round(pv + o.residual / Math.pow(1 + r, o.months));
}

/**
 * Förslag till klassning (K3 20.5–20.6): finansiellt om äganderätten övergår, om löptiden avser större delen av den ekonomiska livslängden
 * eller om nuvärdet av avgifterna motsvarar i stort sett hela verkliga värdet. Personbilar och lokaler är nästan alltid operationella.
 */
export function suggestClass(o: { months: number; lifeMonths: number | null; pv: number; fairValue: number | null; transfer: boolean }) {
  const reasons: string[] = [];
  if (o.transfer) reasons.push('äganderätten övergår vid avtalets slut');
  if (o.lifeMonths && o.months >= 0.75 * o.lifeMonths) reasons.push(`löptiden är ${Math.round((o.months / o.lifeMonths) * 100)} % av den ekonomiska livslängden`);
  if (o.fairValue && o.pv >= 0.9 * o.fairValue) reasons.push(`nuvärdet av avgifterna är ${Math.round((o.pv / o.fairValue) * 100)} % av verkligt värde`);
  return { financial: reasons.length > 0, reasons };
}

export interface ScheduleRow { n: number; period: string; fee: number; interest: number; amortization: number; balance: number }
const addMonths = (period: string, n: number) => { const [y, m] = period.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/** Betalningsplan för finansiell leasing: ränta på skulden, resten amorterar; restvärdet betalas med sista avgiften */
export function schedule(o: { fee: number; months: number; ratePct: number; residual: number; start: string }): ScheduleRow[] {
  const r = monthlyRate(o.ratePct);
  let bal = presentValue(o);
  const rows: ScheduleRow[] = [];
  for (let n = 1; n <= o.months; n++) {
    const pay = o.fee + (n === o.months ? o.residual : 0);
    const interest = Math.round(bal * r);
    let amortization = pay - interest;
    if (n === o.months) amortization = bal; // avrundningen hamnar på sista raden
    bal -= amortization;
    rows.push({ n, period: addMonths(o.start.slice(0, 7), n - 1), fee: pay, interest: pay - amortization, amortization, balance: bal });
  }
  return rows;
}

/** Operationell leasing: avgiften som kostnad. Personbil: halva momsen är avdragsgill (ML 13 kap.), resten blir kostnad. */
export function operationalLines(o: { fee: number; vatRate: number; kind: LeaseKind; bank: number }) {
  const vat = Math.round((o.fee * o.vatRate) / 100);
  const deductible = o.kind === 'car' ? Math.round(vat / 2) : vat;
  const l = [{ account: COST_ACCOUNT[o.kind], amount: o.fee + (vat - deductible) }];
  if (deductible) l.push({ account: INPUT_VAT, amount: deductible });
  l.push({ account: o.bank, amount: -(o.fee + vat) });
  return l;
}

/** Finansiell leasing: tillgång och skuld vid start */
export const financialStartLines = (pv: number, kind: LeaseKind) => [{ account: ASSET_ACCOUNT[kind], amount: pv }, { account: LEASE_DEBT, amount: -pv }];

/** Finansiell leasing: betalning delas på ränta och amortering; momsen på avgiften dras som vanligt */
export function financialPaymentLines(row: Pick<ScheduleRow, 'interest' | 'amortization'>, o: { vatRate: number; kind: LeaseKind; bank: number; fee: number }) {
  const vat = Math.round((o.fee * o.vatRate) / 100);
  const deductible = o.kind === 'car' ? Math.round(vat / 2) : vat;
  const l = [{ account: LEASE_DEBT, amount: row.amortization }];
  if (row.interest) l.push({ account: INTEREST, amount: row.interest });
  if (deductible) l.push({ account: INPUT_VAT, amount: deductible });
  if (vat - deductible) l.push({ account: COST_ACCOUNT[o.kind], amount: vat - deductible });
  l.push({ account: o.bank, amount: -(row.interest + row.amortization + vat) });
  return l;
}

/** Framtida minimileaseavgifter per förfallotid vid ett datum (not i årsredovisningen) */
export function maturity(contracts: { fee: number; residual: number; start: string; months: number }[], at: string) {
  const out = { within1: 0, oneTo5: 0, over5: 0, total: 0 };
  const atP = at.slice(0, 7);
  for (const c of contracts) {
    for (let n = 1; n <= c.months; n++) {
      const p = addMonths(c.start.slice(0, 7), n - 1);
      if (p <= atP) continue;
      const pay = c.fee + (n === c.months ? c.residual : 0);
      const [y1, m1] = atP.split('-').map(Number), [y2, m2] = p.split('-').map(Number);
      const ahead = (y2 - y1) * 12 + (m2 - m1);
      if (ahead <= 12) out.within1 += pay; else if (ahead <= 60) out.oneTo5 += pay; else out.over5 += pay;
      out.total += pay;
    }
  }
  return out;
}
export { addMonths as addLeaseMonths };
