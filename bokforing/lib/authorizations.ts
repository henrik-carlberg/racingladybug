// Fullmakter, tillstånd och certifikat
export const KINDS = { power_of_attorney: 'Fullmakt', permit: 'Tillstånd', certificate: 'Certifikat' } as const;
export type Kind = keyof typeof KINDS;
/** Vanliga fullmakter och tillstånd att utgå från */
export const PRESETS: Record<Kind, string[]> = {
  power_of_attorney: ['Ombud hos Skatteverket', 'Deklarationsombud', 'Ombud hos Bolagsverket', 'Tullombud', 'Fullmakt för bankkonto', 'Fullmakt att företräda bolaget'],
  permit: ['Serveringstillstånd', 'Miljötillstånd', 'Yrkestrafiktillstånd', 'Bygglov', 'Tillstånd för kameraövervakning', 'Tillstånd att hantera brandfarlig vara'],
  certificate: ['ISO 9001', 'ISO 14001', 'ISO 27001', 'Kontrollansvarig', 'Behörighet för elinstallation', 'F-skattebevis'],
};
/** Påminnelse 90 dagar innan något går ut (tillstånd kan ta lång tid att förnya) */
export function expiry(until: string | null, today: string, warnDays = 90) {
  if (!until) return { status: 'open' as const, days: null };
  const days = Math.round((Date.parse(until) - Date.parse(today)) / 864e5);
  return { status: days < 0 ? 'expired' as const : days <= warnDays ? 'expiring' as const : 'valid' as const, days };
}
