// Dataskydd (GDPR)
export const LEGAL_BASES = {
  consent: 'Samtycke (art. 6.1 a)',
  contract: 'Avtal (art. 6.1 b)',
  legal: 'Rättslig förpliktelse (art. 6.1 c)',
  vital: 'Grundläggande intresse (art. 6.1 d)',
  public: 'Allmänt intresse eller myndighetsutövning (art. 6.1 e)',
  legitimate: 'Berättigat intresse (art. 6.1 f)',
} as const;
export const RISKS = {
  none: 'Osannolikt att den leder till en risk för de registrerade',
  risk: 'Risk för de registrerades rättigheter och friheter',
  high: 'Hög risk (t.ex. känsliga uppgifter, personnummer med kontouppgifter, risk för id-kapning)',
} as const;
export type Risk = keyof typeof RISKS;

/** Anmälan till IMY inom 72 timmar om incidenten kan leda till risk (art. 33); de registrerade informeras vid hög risk (art. 34) */
export const incidentDuties = (risk: Risk) => ({ imy: risk !== 'none', subjects: risk === 'high' });
export function deadline(discoveredAt: Date, now: Date) {
  const due = new Date(discoveredAt.getTime() + 72 * 3600e3);
  return { due, hoursLeft: Math.floor((due.getTime() - now.getTime()) / 3600e3), late: now > due };
}
/** Det som saknas innan incidenten kan avslutas */
export function closeBlockers(i: { risk: Risk; reported_imy_at: Date | null; subjects_informed_at: Date | null; measures: string; late_reason: string; discovered_at: Date }) {
  const d = incidentDuties(i.risk), out: string[] = [];
  if (!i.measures.trim()) out.push('åtgärder');
  if (d.imy && !i.reported_imy_at) out.push('anmälan till IMY');
  if (d.imy && i.reported_imy_at && i.reported_imy_at.getTime() - i.discovered_at.getTime() > 72 * 3600e3 && !i.late_reason.trim()) out.push('skäl till försenad anmälan');
  if (d.subjects && !i.subjects_informed_at) out.push('information till de registrerade');
  return out;
}
