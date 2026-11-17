import { formatAmount } from './money';
export const kr = (ore: number | null | undefined) => (ore == null ? '' : formatAmount(ore));
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
export function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function monthEnd(period: string) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
export const ROLE_LABEL = { owner: 'Ägare', accountant: 'Redovisningskonsult' } as const;
