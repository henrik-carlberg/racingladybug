import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, ValidationError } from '@/lib/errors';
import { auditBy } from '@/lib/server/audit';
import { decide, parseRepresentation, soleTraderPnrs, type Representation } from '@/lib/signatory';
import type { Actor } from './actor';
import { hashPnr, userPnrHash } from './bankid';
import { isVerified, setVerified } from './identity';

// Bolagsverkets tjänst för företrädare och firmateckning (kräver avtal). Adress och fält samlade här för att kunna anpassas.
const conf = () => ({ url: (process.env.BV_INFO_URL || '').replace(/\/$/, ''), key: process.env.BV_INFO_KEY || '' });
export const representativesEnabled = () => { const c = conf(); return !!(c.url && c.key); };

export async function fetchRepresentation(orgnr: string): Promise<Representation> {
  const c = conf();
  const u = new URL(`${c.url}/foretag/${encodeURIComponent(orgnr.replace(/\D/g, ''))}/foretradare`);
  if (u.protocol !== 'https:' && !(process.env.AUTHORITY_ALLOW_INSECURE === '1' && u.protocol === 'http:')) throw new Error('Bolagsverkets tjänst måste använda https');
  const r = await fetch(u, { headers: { authorization: `Bearer ${c.key}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new ValidationError('Bolaget finns inte hos Bolagsverket');
  if (!r.ok) throw new Error(`Bolagsverket svarade ${r.status}`);
  return parseRepresentation(await r.json() as Record<string, unknown>);
}

/** Hämtar företrädarna och sparar dem (personnummer bara som kontrollsumma) */
async function refresh(companyId: number, orgnr: string) {
  const rep = await fetchRepresentation(orgnr);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM company_representatives WHERE company_id = ${companyId}`;
    for (const r of rep.reps) await tx`INSERT INTO company_representatives (company_id, name, roles, pnr_hash, alone) VALUES (${companyId}, ${r.name}, ${r.roles}, ${hashPnr(r.pnr)}, ${r.alone}) ON CONFLICT DO NOTHING`;
    await tx`INSERT INTO company_representation (company_id, jointly, text) VALUES (${companyId}, ${rep.jointly}, ${rep.text})
      ON CONFLICT (company_id) DO UPDATE SET jointly = EXCLUDED.jointly, text = EXCLUDED.text, fetched_at = now()`;
  });
  return rep;
}

export async function representationStatus(companyId: number, userId: number) {
  const reps = await sql<{ name: string; roles: string[]; alone: boolean; pnr_hash: string; confirmed: boolean }[]>`
    SELECT r.name, r.roles, r.alone, r.pnr_hash, EXISTS (SELECT 1 FROM signatory_confirmations s WHERE s.company_id = r.company_id AND s.pnr_hash = r.pnr_hash) AS confirmed
    FROM company_representatives r WHERE r.company_id = ${companyId} ORDER BY r.alone DESC, r.name`;
  const [rule] = await sql<{ jointly: number; text: string; fetched: string }[]>`SELECT jointly, text, to_char(fetched_at,'YYYY-MM-DD HH24:MI') AS fetched FROM company_representation WHERE company_id = ${companyId}`;
  const mine = await userPnrHash(userId);
  const [c] = await sql<{ verified: string | null; method: string | null; type: string }[]>`SELECT to_char(identity_verified_at,'YYYY-MM-DD') AS verified, identity_method AS method, company_type AS type FROM companies WHERE id = ${companyId}`;
  return { reps: reps.map(({ pnr_hash, ...r }) => ({ ...r, me: !!mine && pnr_hash === mine })), rule: rule ?? null, hasBankId: !!mine, verified: c.verified, method: c.method, type: c.type };
}

/**
 * Användaren bekräftar med sitt kopplade BankID att hen företräder bolaget.
 * Enskild firma: BankID-personnumret ska vara organisationsnumret. Aktiebolag m.fl.: personen ska vara företrädare enligt
 * Bolagsverket, och ensam firmatecknare – annars krävs bekräftelse från så många ledamöter som firmateckningen kräver.
 */
export async function confirmAsSignatory(actor: Actor) {
  const mine = await userPnrHash(actor.userId);
  if (!mine) throw new ValidationError('Koppla BankID till ditt konto först (Mitt konto → BankID)');
  if (await isVerified(actor.companyId)) return { verified: true, missing: 0 };
  const [c] = await sql<{ orgnr: string; type: string; demo: boolean }[]>`SELECT orgnr, company_type AS type, is_demo AS demo FROM companies WHERE id = ${actor.companyId}`;
  if (c.demo) throw new ValidationError('Demobolaget kan inte verifieras');
  const verify = async () => {
    try { await setVerified(actor.userId, actor.companyId, true, 'bankid'); }
    catch (e) { if (e instanceof ConflictError) throw new ConflictError('Ett annat konto för samma organisationsnummer är redan verifierat – kontakta supporten'); throw e; }
    await auditBy(sql, actor, 'verify_signatory', 'company', actor.companyId);
    return { verified: true, missing: 0 };
  };
  if (c.type === 'EF') {
    if (!soleTraderPnrs(c.orgnr).map(hashPnr).includes(mine)) throw new ValidationError('Ditt BankID hör inte till innehavaren av firman (organisationsnumret är innehavarens personnummer)');
    return verify();
  }
  if (!representativesEnabled()) throw new ValidationError('Hämtning av firmatecknare från Bolagsverket är inte uppsatt – kontakta supporten för att verifiera bolaget');
  const rep = await refresh(actor.companyId, c.orgnr);
  const me = rep.reps.find((r) => hashPnr(r.pnr) === mine);
  if (!me) throw new ValidationError('Du finns inte bland bolagets företrädare hos Bolagsverket');
  await sql`INSERT INTO signatory_confirmations (company_id, user_id, pnr_hash) VALUES (${actor.companyId}, ${actor.userId}, ${mine}) ON CONFLICT DO NOTHING`;
  const confirmed = new Set((await sql<{ h: string }[]>`SELECT pnr_hash AS h FROM signatory_confirmations WHERE company_id = ${actor.companyId}`).map((r) => r.h));
  const d = decide(rep, rep.reps.filter((r) => confirmed.has(hashPnr(r.pnr))).map((r) => r.pnr));
  await auditBy(sql, actor, 'confirm_signatory', 'company', actor.companyId, { missing: d.missing });
  return d.verified ? verify() : { verified: false, missing: d.missing };
}

/** Namnen på företrädarna, t.ex. som förslag på vem som skriver under årsredovisningen */
export async function representativeNames(companyId: number) {
  return [...await sql<{ name: string; roles: string[] }[]>`SELECT name, roles FROM company_representatives WHERE company_id = ${companyId} ORDER BY name`];
}
