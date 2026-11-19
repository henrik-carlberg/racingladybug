// Firmateckning – ren logik (testbar). Avgör om de som har identifierat sig med BankID tillsammans får företräda bolaget.

export interface Representative { name: string; pnr: string; roles: string[]; alone: boolean }
export interface Representation { companyName: string; reps: Representative[]; jointly: number; text: string }

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
/** Personnummer med sekelsiffror (ÅÅÅÅMMDDNNNN). Tio siffror tolkas som 1900- eller 2000-tal efter åldern. */
export function fullPnr(v: unknown, now = new Date()): string | null {
  const d = digits(v);
  if (/^(19|20)\d{10}$/.test(d)) return d;
  if (/^\d{10}$/.test(d)) { const yy = Number(d.slice(0, 2)), cur = now.getUTCFullYear() % 100; return `${yy > cur ? '19' : '20'}${d}`; }
  return null;
}

/**
 * Svar från Bolagsverkets tjänst för företrädare (normaliserat). Fält som tjänsten använder:
 * namn, foretradare[{ personnummer, namn, roller[], ensamFirmatecknare }], firmateckning{ antalIForening, text }.
 */
export function parseRepresentation(j: Record<string, unknown>): Representation {
  const list = Array.isArray(j.foretradare) ? (j.foretradare as Record<string, unknown>[]) : [];
  const reps = list.map((r) => ({ name: String(r.namn ?? '').slice(0, 120), pnr: fullPnr(r.personnummer) ?? '', roles: (Array.isArray(r.roller) ? r.roller : []).map((x) => String(x).slice(0, 60)), alone: r.ensamFirmatecknare === true }))
    .filter((r) => r.pnr);
  const f = (j.firmateckning ?? {}) as Record<string, unknown>;
  const n = Number(f.antalIForening);
  return { companyName: String(j.namn ?? ''), reps, jointly: Number.isInteger(n) && n >= 1 && n <= 10 ? n : 2, text: String(f.text ?? '').slice(0, 1000) };
}

const SIGNING_ROLES = /styrelseledamot|ordförande|firmatecknare|innehavare|bolagsman|komplementär/i;

/** Verifierat om någon som har bekräftat får teckna ensam, eller om tillräckligt många ledamöter har bekräftat tillsammans. */
export function decide(r: Representation, confirmedPnrs: string[]) {
  const confirmed = r.reps.filter((x) => confirmedPnrs.includes(x.pnr));
  if (confirmed.some((x) => x.alone)) return { verified: true, missing: 0, confirmed };
  const signing = confirmed.filter((x) => SIGNING_ROLES.test(x.roles.join(' ')));
  const missing = Math.max(0, r.jointly - signing.length);
  return { verified: signing.length > 0 && missing === 0, missing, confirmed };
}

/** Enskild firma: organisationsnumret är innehavarens personnummer */
export const soleTraderPnrs = (orgnr: string) => { const d = digits(orgnr); return d.length === 10 ? [`19${d}`, `20${d}`] : []; };
