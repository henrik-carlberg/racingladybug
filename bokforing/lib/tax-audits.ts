// Skatterevision och omprövning (skatteförfarandelagen). Belopp i öre.
export const SUBJECTS = {
  income: { label: 'Inkomstskatt', account: 8920, name: 'Skatt på grund av ändrad beskattning' },
  vat: { label: 'Mervärdesskatt', account: 6991, name: 'Övriga externa kostnader, avdragsgilla (tillkommande moms)' },
  payroll: { label: 'Arbetsgivaravgifter och skatteavdrag', account: 7519, name: 'Arbetsgivaravgifter (tillkommande enligt beslut)' },
  other: { label: 'Annat', account: 6991, name: 'Övriga externa kostnader, avdragsgilla (tillkommande moms)' },
} as const;
export type Subject = keyof typeof SUBJECTS;
export const TAX_ACCOUNT = 1630, SURCHARGE = 6992, INTEREST = 8423;

/** Begäran om omprövning och överklagande: senast sjätte året efter beskattningsåret (SFL 66 kap. 7 § och 67 kap. 12 §) */
export const appealDeadline = (taxYear: number) => `${taxYear + 6}-12-31`;
/** Beslutet belastar skattekontot: tillkommande skatt, skattetillägg (ej avdragsgillt) och kostnadsränta (ej avdragsgill) */
export function decisionLines(subject: Subject, tax: number, surcharge: number, interest: number) {
  const out = [];
  if (tax) out.push({ account: SUBJECTS[subject].account, amount: tax });
  if (surcharge) out.push({ account: SURCHARGE, amount: surcharge });
  if (interest) out.push({ account: INTEREST, amount: interest });
  const total = tax + surcharge + interest;
  if (total) out.push({ account: TAX_ACCOUNT, amount: -total });
  return out;
}
export function requestStatus(due: string, answered: string | null, today: string) {
  if (answered) return 'answered' as const;
  const d = Math.round((Date.parse(due) - Date.parse(today)) / 864e5);
  return d < 0 ? 'late' as const : d <= 7 ? 'soon' as const : 'open' as const;
}
