// Provisioner och säljbonus (ren logik). Belopp i öre, procentsatser i procent.
export const AGENT_COMMISSION_ACCOUNT = 6090; // Provisioner till agenter (övriga försäljningskostnader)

export interface Rule { scope: 'customer' | 'account'; customerId: number | null; account: number | null; ratePct: number; sellerId: number | null }

/** Mest specifika regeln vinner: säljarens kundregel > allmän kundregel > säljarens kontoregel > allmän kontoregel > säljarens grundsats */
export function rateFor(rules: Rule[], o: { sellerId: number; customerId: number; account: number; baseRate: number }): number {
  const pick = (scope: Rule['scope'], seller: boolean) => rules.find((r) => r.scope === scope && (seller ? r.sellerId === o.sellerId : r.sellerId == null)
    && (scope === 'customer' ? r.customerId === o.customerId : r.account === o.account));
  return (pick('customer', true) ?? pick('customer', false) ?? pick('account', true) ?? pick('account', false))?.ratePct ?? o.baseRate;
}

/** Provision på en faktura: underlaget (exkl. moms, i kronor) fördelas på raderna så att kontoregler kan användas */
export function invoiceCommission(o: { netSek: number; lines: { account: number; net: number }[]; sellerId: number; customerId: number; baseRate: number; rules: Rule[] }) {
  const sum = o.lines.reduce((s, l) => s + l.net, 0);
  if (!sum) return Math.round((o.netSek * o.baseRate) / 100);
  let c = 0;
  for (const l of o.lines) c += (o.netSek * (l.net / sum) * rateFor(o.rules, { sellerId: o.sellerId, customerId: o.customerId, account: l.account, baseRate: o.baseRate })) / 100;
  return Math.round(c);
}

/** Bonustrappa: varje steg ger sin procentsats på den del av periodens försäljning som ligger över steget (progressivt) */
export function tierBonus(tiers: { threshold: number; ratePct: number }[], basis: number) {
  const t = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let bonus = 0;
  t.forEach((s, i) => {
    const top = i + 1 < t.length ? t[i + 1].threshold : Infinity;
    if (basis > s.threshold) bonus += ((Math.min(basis, top) - s.threshold) * s.ratePct) / 100;
  });
  return Math.round(bonus);
}

/** Målbonus: fast belopp när periodens försäljning når målet */
export const targetBonus = (o: { target: number | null; amount: number | null; basis: number }) => (o.target && o.amount && o.basis >= o.target ? o.amount : 0);

/** Moms på självfaktura till en momsregistrerad agent */
export const selfInvoiceVat = (amount: number, vatRegistered: boolean) => (vatRegistered ? Math.round(amount * 0.25) : 0);
