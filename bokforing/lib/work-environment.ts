// Systematiskt arbetsmiljöarbete (SAM)
export const INCIDENTS = {
  near_miss: 'Tillbud (ingen skadades)',
  injury: 'Arbetsolycka med skada',
  serious: 'Allvarlig olycka eller allvarligt tillbud',
  disease: 'Arbetssjukdom',
} as const;
export type IncidentKind = keyof typeof INCIDENTS;

/** Riskvärde sannolikhet × konsekvens (1–25) */
export function riskLevel(p: number, c: number) {
  const score = p * c;
  return { score, level: score >= 15 ? 'high' as const : score >= 8 ? 'medium' as const : 'low' as const };
}
/**
 * Anmälningsplikt: allvarliga olyckor och allvarliga tillbud anmäls till Arbetsmiljöverket utan dröjsmål (AML 3 kap. 3 a §);
 * arbetsskador (olycksfall och arbetssjukdom) anmäls till Försäkringskassan (SFB 42 kap. 10 §)
 */
export const duties = (kind: IncidentKind) => ({ av: kind === 'serious', fk: kind === 'injury' || kind === 'serious' || kind === 'disease' });
/** Anmälningar som saknas: Arbetsmiljöverket senast dagen efter, Försäkringskassan inom en vecka */
export function missingReports(i: { kind: IncidentKind; date: string; reported_av_on: string | null; reported_fk_on: string | null }, today: string) {
  const d = duties(i.kind), age = Math.round((Date.parse(today) - Date.parse(i.date)) / 864e5);
  return { av: d.av && !i.reported_av_on, avLate: d.av && !i.reported_av_on && age >= 1, fk: d.fk && !i.reported_fk_on, fkLate: d.fk && !i.reported_fk_on && age > 7 };
}
/** Årlig uppföljning (AFS 2023:1) */
export const CHECKLIST = {
  policy: 'Arbetsmiljöpolicy finns och är känd',
  delegation: 'Uppgifter i arbetsmiljöarbetet är fördelade skriftligt (fler än tio anställda)',
  risks: 'Riskbedömningar är gjorda och uppdaterade',
  plan: 'Handlingsplan med åtgärder, ansvar och tidplan',
  incidents: 'Tillbud och olyckor är utredda och åtgärdade',
  rehab: 'Rutiner för arbetsanpassning och rehabilitering',
  intro: 'Introduktion av nyanställda',
  osa: 'Organisatorisk och social arbetsmiljö (arbetsbelastning, kränkande särbehandling)',
  firstaid: 'Första hjälpen och krisstöd',
} as const;
export const reviewProgress = (checked: string[]) => ({ done: Object.keys(CHECKLIST).filter((k) => checked.includes(k)).length, total: Object.keys(CHECKLIST).length });
