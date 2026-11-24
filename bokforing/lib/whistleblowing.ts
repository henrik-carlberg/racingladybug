// Visselblåsarkanal (lag 2021:890 om skydd för personer som rapporterar om missförhållanden)
export const CATEGORIES = {
  fraud: 'Bedrägeri, korruption eller mutor',
  accounting: 'Felaktig bokföring eller ekonomisk brottslighet',
  safety: 'Arbetsmiljö och säkerhet',
  environment: 'Miljö',
  discrimination: 'Diskriminering eller trakasserier',
  privacy: 'Dataskydd och integritet',
  other: 'Annat missförhållande',
} as const;
export type Category = keyof typeof CATEGORIES;
/** Krav på intern rapporteringskanal från 50 arbetstagare */
export const THRESHOLD = 50;
export const ACK_DAYS = 7, FEEDBACK_MONTHS = 3, RETENTION_YEARS = 2;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Ärendekod som den som rapporterar använder för att följa ärendet (80 bitar slump) */
export function caseCode(bytes: Uint8Array) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  return out.slice(0, 16).replace(/(.{4})(?=.)/g, '$1-');
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; };
/** Frister: bekräftelse inom 7 dagar och återkoppling inom 3 månader från mottagandet */
export function deadlines(r: { received_at: Date; acknowledged_at: Date | null; feedback_at: Date | null; status: string }, now: Date) {
  const ackBy = addDays(r.received_at, ACK_DAYS), feedbackBy = addMonths(r.received_at, FEEDBACK_MONTHS);
  return {
    ackBy, feedbackBy,
    ackOverdue: !r.acknowledged_at && now > ackBy,
    feedbackOverdue: r.status === 'open' && !r.feedback_at && now > feedbackBy,
  };
}
/** Personuppgifter i ett avslutat ärende gallras senast två år efter avslutet */
export const purgeAfter = (closedAt: Date) => addMonths(closedAt, RETENTION_YEARS * 12);
