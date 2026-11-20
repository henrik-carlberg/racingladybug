// Avsättningar och åtaganden (ren logik). Belopp i öre; rader med positivt belopp = debet.
export type ProvisionKind = 'warranty' | 'restructuring' | 'dispute' | 'other';
export type CommitmentKind = 'business_mortgage' | 'property_mortgage' | 'pledged_asset' | 'guarantee' | 'other_contingent';
export interface SignedLine { account: number; amount: number }

export const PROVISION_LABEL: Record<ProvisionKind, string> = { warranty: 'Garantiåtaganden', restructuring: 'Omstrukturering', dispute: 'Tvist eller skadestånd', other: 'Övrig avsättning' };
export const PROVISION_ACCOUNT: Record<ProvisionKind, number> = { warranty: 2220, restructuring: 2290, dispute: 2290, other: 2290 };
export const COMMITMENT_LABEL: Record<CommitmentKind, string> = { business_mortgage: 'Företagsinteckningar', property_mortgage: 'Fastighetsinteckningar', pledged_asset: 'Pantsatta tillgångar',
  guarantee: 'Borgensförbindelser och garantier', other_contingent: 'Övriga eventualförpliktelser' };
export const isPledge = (k: CommitmentKind) => k === 'business_mortgage' || k === 'property_mortgage' || k === 'pledged_asset';

/** Avsättning (kostnad mot 22xx), ianspråktagande (22xx mot bank) eller upplösning (22xx mot kostnaden) */
export function movementLines(kind: 'set' | 'use' | 'release', o: { provision: number; cost: number; amount: number; bank?: number }): SignedLine[] {
  if (kind === 'set') return [{ account: o.cost, amount: o.amount }, { account: o.provision, amount: -o.amount }];
  if (kind === 'use') return [{ account: o.provision, amount: o.amount }, { account: o.bank ?? 1930, amount: -o.amount }];
  return [{ account: o.provision, amount: o.amount }, { account: o.cost, amount: -o.amount }];
}

export interface Movement { kind: 'set' | 'use' | 'release'; date: string; amount: number }
/** Notens rörelser för året: ingående, avsatt, ianspråktaget, återfört och utgående */
export function roll(movements: Movement[], from: string, to: string) {
  let opening = 0, set = 0, used = 0, released = 0;
  for (const m of movements) {
    const sign = m.kind === 'set' ? 1 : -1;
    if (m.date < from) opening += sign * m.amount;
    else if (m.date <= to) { if (m.kind === 'set') set += m.amount; else if (m.kind === 'use') used += m.amount; else released += m.amount; }
  }
  return { opening, set, used, released, closing: opening + set - used - released };
}

/**
 * Garantiavsättning: erfarenhetsbaserad procent av årets försäljning. Skattemässigt avdragsgill högst med de faktiska
 * garantiutgifterna i förhållande till försäljningen de två senaste åren (inkomstskattelagen 16 kap. 3–4 §§).
 */
export function warrantyProposal(o: { sales: number; ratePct: number; current: number; history?: { sales: number; costs: number }[] }) {
  const target = Math.round((o.sales * o.ratePct) / 100);
  const hist = (o.history ?? []).filter((h) => h.sales > 0);
  const histRate = hist.length ? hist.reduce((s, h) => s + h.costs, 0) / hist.reduce((s, h) => s + h.sales, 0) : null;
  const taxMax = histRate == null ? null : Math.round(o.sales * histRate);
  return { target, change: target - o.current, taxMax, nonDeductible: taxMax == null ? 0 : Math.max(0, target - taxMax) };
}

export interface Commitment { kind: CommitmentKind; description: string; amount: number }
/** Noten Ställda säkerheter och eventualförpliktelser */
export function commitmentNote(rows: Commitment[]) {
  const sum = (p: (c: Commitment) => boolean) => rows.filter(p).reduce((s, c) => s + c.amount, 0);
  const byKind = (Object.keys(COMMITMENT_LABEL) as CommitmentKind[]).map((k) => ({ kind: k, label: COMMITMENT_LABEL[k], amount: sum((c) => c.kind === k) })).filter((r) => r.amount);
  return { pledges: byKind.filter((r) => isPledge(r.kind)), contingent: byKind.filter((r) => !isPledge(r.kind)), pledgeTotal: sum((c) => isPledge(c.kind)), contingentTotal: sum((c) => !isPledge(c.kind)) };
}
