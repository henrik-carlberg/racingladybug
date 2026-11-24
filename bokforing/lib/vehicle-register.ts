// Fordonsregister. Belopp i öre.
export const EVENTS = {
  fuel: { label: 'Drivmedel', account: 5611 },
  service: { label: 'Service', account: 5613 },
  repair: { label: 'Reparation', account: 5613 },
  inspection: { label: 'Besiktning', account: 5613 },
  tyres: { label: 'Däck och däckbyte', account: 5613 },
  tax: { label: 'Fordonsskatt', account: 5612 },
  insurance: { label: 'Försäkring', account: 5612 },
  other: { label: 'Övrigt', account: 5619 },
} as const;
export type EventKind = keyof typeof EVENTS;
export const ACCOUNT_NAMES: Record<number, string> = { 5611: 'Drivmedel för personbilar', 5612: 'Försäkring och skatt för personbilar', 5613: 'Reparation och underhåll av personbilar', 5619: 'Övriga personbilskostnader' };
/** Fordonsskatt och försäkring har ingen moms; övrigt med moms (moms på drivmedel och service för personbil är avdragsgill) */
export const hasVat = (k: EventKind) => k !== 'tax' && k !== 'insurance';
export const eventLines = (kind: EventKind, amount: number, vat: number, credit = 1930) => [
  { account: EVENTS[kind].account, amount }, ...(vat ? [{ account: 2641, amount: vat }] : []), { account: credit, amount: -(amount + vat) },
];

const days = (d: string, today: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
/** Påminnelser: besiktning, försäkring och service inom 30 dagar, service inom 1 000 km och däckbyte enligt vinterväglagen */
export function reminders(v: { inspection_due: string | null; insurance_until: string | null; service_due_date: string | null; service_due_km: number | null }, odometer: number | null, today: string) {
  const out: { kind: string; text: string; overdue: boolean }[] = [];
  const check = (d: string | null, kind: string, label: string) => { if (!d) return; const n = days(d, today); if (n <= 30) out.push({ kind, text: n < 0 ? `${label} skulle ha gjorts ${d}` : `${label} senast ${d} (om ${n} dagar)`, overdue: n < 0 }); };
  check(v.inspection_due, 'inspection', 'Besiktning');
  check(v.insurance_until, 'insurance', 'Försäkringen förnyas');
  check(v.service_due_date, 'service', 'Service');
  if (v.service_due_km != null && odometer != null && v.service_due_km - odometer <= 1000) out.push({ kind: 'service_km', text: odometer >= v.service_due_km ? `Service vid ${v.service_due_km} km har passerats (mätaren visar ${odometer} km)` : `Service vid ${v.service_due_km} km (${v.service_due_km - odometer} km kvar)`, overdue: odometer >= v.service_due_km });
  return out;
}
/** Vinterdäck krävs 1 december–31 mars vid vinterväglag; dubbdäck får användas till 15 april */
export function tyreReminder(today: string) {
  const md = today.slice(5);
  if (md >= '10-15' && md <= '11-30') return 'Byt till vinterdäck – de krävs från 1 december vid vinterväglag';
  if (md >= '04-01' && md <= '04-15') return 'Byt till sommardäck – dubbdäck får användas till 15 april';
  return null;
}
/** Kostnad per mil: bokförda kostnader och avskrivning delat med körda mil */
export const costPerMil = (costs: number, km: number) => (km > 0 ? Math.round(costs / (km / 10)) : null);
