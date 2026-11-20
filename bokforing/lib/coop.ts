// Ekonomiska föreningar och stiftelser (ren logik). Belopp i öre.
export const INSATS_ACCOUNT = 2083;        // Medlemsinsatser
export const REFUND_ACCOUNT = 3739;        // Återbäring till medlemmar (minskar nettoomsättningen)
export const REFUND_DEBT_ACCOUNT = 2891;   // Beslutad, ej utbetald återbäring
export const PURPOSE_ACCOUNT = 6993;       // Lämnade bidrag och gåvor (stiftelsens ändamål)
export const GRANT_DEBT_ACCOUNT = 2895;    // Beviljade, ej utbetalda bidrag
export const FULFILMENT_PCT = 80;          // Fullföljdskravet (7 kap. 6 § IL): ca 80 % av avkastningen över fem år
export const FULFILMENT_YEARS = 5;

export type OrgForm = 'ek' | 'stiftelse';
export const ORG_FORM_LABEL: Record<OrgForm, string> = { ek: 'Ekonomisk förening', stiftelse: 'Stiftelse' };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function addMonths(iso: string, m: number) {
  const [y, mo, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return ymd(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))));
}

/**
 * Utträde ur ekonomisk förening (lag 2018:672, 4 kap.): avgången sker vid utgången av det räkenskapsår som
 * slutar tidigast en månad efter uppsägningen, och insatsen betalas ut sex månader efter avgången.
 * `fyEnds` är räkenskapsårens slutdagar; saknas ett passande år antas kalenderår.
 */
export function exitDates(noticeOn: string, fyEnds: string[]) {
  const earliest = addMonths(noticeOn, 1);
  const end = [...fyEnds].sort().find((e) => e >= earliest) ?? `${earliest.slice(0, 4)}-12-31`;
  return { leavesOn: end, payableFrom: addMonths(end, 6) };
}

/** Fördelar ett belopp i proportion till underlagen (största rest), så att summan stämmer på öret */
export function proportional<T extends { base: number }>(total: number, rows: T[]): (T & { amount: number })[] {
  const pos = rows.map((r) => ({ ...r, base: Math.max(0, r.base) }));
  const sum = pos.reduce((s, r) => s + r.base, 0);
  if (!sum || total <= 0) return pos.map((r) => ({ ...r, amount: 0 }));
  const raw = pos.map((r) => (total * r.base) / sum);
  const out = pos.map((r, i) => ({ ...r, amount: Math.floor(raw[i]) }));
  let rest = total - out.reduce((s, r) => s + r.amount, 0);
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) { if (rest <= 0) break; out[o.i].amount += 1; rest -= 1; }
  return out;
}

/** Beslutad återbäring: minskar nettoomsättningen mot skuld till medlemmarna */
export function refundLines(total: number) {
  return [{ account: REFUND_ACCOUNT, amount: total }, { account: REFUND_DEBT_ACCOUNT, amount: -total }];
}
export function insatsLines(kind: 'paid' | 'repaid', amount: number, bank = 1930) {
  return kind === 'paid'
    ? [{ account: bank, amount }, { account: INSATS_ACCOUNT, amount: -amount }]
    : [{ account: INSATS_ACCOUNT, amount }, { account: bank, amount: -amount }];
}

/** Stiftelsens avkastning för ett år: intäkter (3xxx, 80xx–83xx) minus förvaltningskostnader och räntekostnader, utan ändamålskostnaderna */
export function yieldOf(sums: Map<number, number>, purposeAccount = PURPOSE_ACCOUNT) {
  let income = 0, admin = 0, purpose = 0;
  for (const [n, v] of sums) {
    if ((n >= 3000 && n <= 3999) || (n >= 8000 && n <= 8399)) income -= v;
    else if (n === purposeAccount) purpose += v;
    else if ((n >= 4000 && n <= 7999) || (n >= 8400 && n <= 8499)) admin += v;
  }
  return { income, admin, yield: income - admin, purpose };
}

/** Fullföljdskravet över en rullande femårsperiod: ändamålskostnaderna ska motsvara minst 80 % av avkastningen */
export function fulfilment<T extends { year: number; yield: number; purpose: number }>(years: T[]) {
  const sorted = [...years].sort((a, b) => a.year - b.year);
  return sorted.map((y, i) => {
    const win = sorted.slice(Math.max(0, i - FULFILMENT_YEARS + 1), i + 1);
    const yld = win.reduce((s, w) => s + Math.max(0, w.yield), 0);
    const used = win.reduce((s, w) => s + w.purpose, 0);
    const required = Math.round((yld * FULFILMENT_PCT) / 100);
    return { ...y, windowYears: win.length, windowYield: yld, windowPurpose: used, required, shortfall: Math.max(0, required - used), pct: yld > 0 ? Math.round((used / yld) * 1000) / 10 : null };
  });
}

export function grantLines(kind: 'decide' | 'pay', amount: number, bank = 1930) {
  return kind === 'decide'
    ? [{ account: PURPOSE_ACCOUNT, amount }, { account: GRANT_DEBT_ACCOUNT, amount: -amount }]
    : [{ account: GRANT_DEBT_ACCOUNT, amount }, { account: bank, amount: -amount }];
}
