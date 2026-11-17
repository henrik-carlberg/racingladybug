// Prislista och åtkomst för abonnemang. Rena funktioner – ändra priserna här.

export const TRIAL_DAYS = 30;
/** Grundpris per bolag och månad i öre exkl. moms: bokföring, fakturering, moms, lön, bank, kvitton, deadlines, bokslut, tid och e-signering */
export const BASE_PRICE = 9900;
/** Pris per aktiverad tilläggsmodul och månad i öre exkl. moms */
export const MODULE_PRICE = 3900;
/** Moduler som ingår i grundpriset */
export const FREE_MODULES = ['crm'];

export function monthlyPrice(enabledModules: string[]) {
  const paid = enabledModules.filter((m) => !FREE_MODULES.includes(m));
  return { base: BASE_PRICE, modules: paid.length * MODULE_PRICE, paid, total: BASE_PRICE + paid.length * MODULE_PRICE };
}

export type Access = { state: 'exempt' | 'active' | 'trial' | 'past_due' | 'locked'; daysLeft?: number };

/** Har bolaget tillgång? Förfallen betalning ger 14 dagars nåd innan spärr. */
export function access(o: { exempt: boolean; status: string | null; trialEndsAt: string | null; periodEnd: string | null; today: string }): Access {
  if (o.exempt) return { state: 'exempt' };
  if (o.status === 'active') return { state: 'active' };
  const days = (d: string) => Math.ceil((Date.parse(d) - Date.parse(o.today)) / 86400000);
  if (o.status === 'past_due' && o.periodEnd && days(o.periodEnd) > -14) return { state: 'past_due', daysLeft: days(o.periodEnd) + 14 };
  if ((o.status === 'trialing' || !o.status) && o.trialEndsAt && days(o.trialEndsAt) >= 0) return { state: 'trial', daysLeft: days(o.trialEndsAt) };
  if (o.status === 'canceled' && o.periodEnd && days(o.periodEnd) >= 0) return { state: 'active' };
  return { state: 'locked' };
}

export const billingEnforced = () => process.env.BILLING_ENFORCED === 'true';
export const signupOpen = () => process.env.ALLOW_SIGNUP !== 'false';
