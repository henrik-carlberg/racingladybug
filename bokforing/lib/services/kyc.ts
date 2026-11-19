import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { audit } from '@/lib/server/audit';
import { sendMail } from '@/lib/server/mail';
import { today } from '@/lib/format';
import { assessRisk, ENGAGEMENT_SERVICES, engagementLetter, KYC_FACTORS, kycStatus, parseOwners, type EngagementService, type KycFactor, type Owner, type Risk } from '@/lib/kyc';
import { requireFirm } from './firms';
import { createDocument, sendDocument } from './documents';

const conf = () => ({ url: (process.env.BV_INFO_URL || '').replace(/\/$/, ''), key: process.env.BV_INFO_KEY || '' });
export const ownersRegisterEnabled = () => { const c = conf(); return !!(c.url && c.key); };

export interface Kyc {
  risk: Risk | null; score: number | null; factors: KycFactor[]; pep: boolean | null; pep_details: string; identified: 'bankid' | 'meeting' | 'remote' | null;
  purpose: string; notes: string; owners: Owner[]; owners_fetched_at: string | null; assessed_by: string | null; assessed_at: string | null; next_review: string | null;
  engagement_document_id: number | null; engagement_status: string | null;
}

async function client(userId: number, firmId: number, companyId: number) {
  await requireFirm(userId, firmId);
  const [c] = await sql<{ id: number; name: string; orgnr: string }[]>`SELECT c.id, c.name, c.orgnr FROM firm_clients fc JOIN companies c ON c.id = fc.company_id
    WHERE fc.firm_id = ${firmId} AND fc.company_id = ${companyId}`;
  if (!c) throw new NotFoundError('Klienten');
  return c;
}

export async function getKyc(userId: number, firmId: number, companyId: number) {
  const c = await client(userId, firmId, companyId);
  const [k] = await sql<Kyc[]>`SELECT k.risk, k.score, k.factors, k.pep, k.pep_details, k.identified, k.purpose, k.notes, k.owners,
      to_char(k.owners_fetched_at,'YYYY-MM-DD') AS owners_fetched_at, u.name AS assessed_by, to_char(k.assessed_at,'YYYY-MM-DD') AS assessed_at,
      to_char(k.next_review,'YYYY-MM-DD') AS next_review, k.engagement_document_id, d.status AS engagement_status
    FROM firm_kyc k LEFT JOIN users u ON u.id = k.assessed_by LEFT JOIN documents d ON d.id = k.engagement_document_id
    WHERE k.firm_id = ${firmId} AND k.company_id = ${companyId}`;
  const history = await sql<{ date: string; by: string | null; risk: string | null }[]>`SELECT to_char(h.created_at,'YYYY-MM-DD') AS date, u.name AS by, h.snapshot->>'risk' AS risk
    FROM firm_kyc_history h LEFT JOIN users u ON u.id = h.created_by WHERE h.firm_id = ${firmId} AND h.company_id = ${companyId} ORDER BY h.created_at DESC LIMIT 20`;
  const owner = (await sql<{ id: number; name: string; email: string }[]>`SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.company_id = ${companyId} AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`)[0] ?? null;
  return { client: c, kyc: k ?? null, history: [...history], owner, status: kycStatus(k?.next_review ?? null, today()) };
}

/** Verkliga huvudmän hämtas från Bolagsverkets register */
export async function fetchOwners(userId: number, firmId: number, companyId: number) {
  const c = await client(userId, firmId, companyId);
  const cf = conf();
  if (!ownersRegisterEnabled()) throw new ValidationError('Bolagsverkets register är inte kopplat');
  const u = new URL(`${cf.url}/foretag/${encodeURIComponent(c.orgnr.replace(/\D/g, ''))}/verkliga-huvudman`);
  if (u.protocol !== 'https:' && !(process.env.AUTHORITY_ALLOW_INSECURE === '1' && u.protocol === 'http:')) throw new Error('Bolagsverkets tjänst måste använda https');
  const r = await fetch(u, { headers: { authorization: `Bearer ${cf.key}`, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new ValidationError('Ingen verklig huvudman är registrerad – det ska bolaget anmäla till Bolagsverket');
  if (!r.ok) throw new Error(`Bolagsverket svarade ${r.status}`);
  const owners = parseOwners(await r.json());
  await sql`INSERT INTO firm_kyc (firm_id, company_id, owners, owners_fetched_at) VALUES (${firmId}, ${companyId}, ${sql.json(owners as never)}, now())
    ON CONFLICT (firm_id, company_id) DO UPDATE SET owners = EXCLUDED.owners, owners_fetched_at = now()`;
  await audit(sql, { companyId: null, userId, action: 'kyc_owners', entity: 'firm', entityId: firmId, details: { client: companyId } });
  return owners;
}

export async function saveAssessment(userId: number, firmId: number, companyId: number, input: { factors: string[]; pep: string; pep_details: string; identified: string; purpose: string; notes: string }) {
  await client(userId, firmId, companyId);
  const factors = [...new Set(input.factors)].filter((f): f is KycFactor => f in KYC_FACTORS);
  if (input.pep !== 'yes' && input.pep !== 'no') throw new ValidationError('Ange om någon är person i politiskt utsatt ställning (PEP)');
  if (!['bankid', 'meeting', 'remote'].includes(input.identified)) throw new ValidationError('Ange hur kundens företrädare har identifierats');
  if (!input.purpose.trim()) throw new ValidationError('Beskriv affärsförbindelsens syfte och art');
  const pep = input.pep === 'yes';
  if (pep && !input.pep_details.trim()) throw new ValidationError('Beskriv vem som är PEP och vilken befattning');
  const all = input.identified === 'remote' && !factors.includes('remote') ? [...factors, 'remote' as const] : factors;
  const date = today();
  const a = assessRisk(all, pep, date);
  await sql.begin(async (tx) => {
    const [k] = await tx<{ owners_fetched_at: Date | null }[]>`SELECT owners_fetched_at FROM firm_kyc WHERE firm_id = ${firmId} AND company_id = ${companyId}`;
    if (!k?.owners_fetched_at) throw new ValidationError('Hämta verkliga huvudmän från Bolagsverket först');
    const row = { risk: a.risk, score: a.score, factors: all, pep, pep_details: input.pep_details.slice(0, 1000), identified: input.identified,
      purpose: input.purpose.slice(0, 2000), notes: input.notes.slice(0, 5000), assessed_by: userId, assessed_at: date, next_review: a.nextReview };
    await tx`UPDATE firm_kyc SET ${tx(row)} WHERE firm_id = ${firmId} AND company_id = ${companyId}`;
    const [snap] = await tx<{ s: unknown }[]>`SELECT to_jsonb(k) - 'firm_id' - 'company_id' AS s FROM firm_kyc k WHERE firm_id = ${firmId} AND company_id = ${companyId}`;
    await tx`INSERT INTO firm_kyc_history (firm_id, company_id, snapshot, created_by) VALUES (${firmId}, ${companyId}, ${tx.json(snap.s as never)}, ${userId})`;
    // Loggas på byrån, inte i kundens historik (kunden ska inte se byråns riskbedömning)
    await audit(tx, { companyId: null, userId, action: 'kyc_assess', entity: 'firm', entityId: firmId, details: { client: companyId } });
  });
  return a;
}

/** Uppdragsbrevet skickas för e-signering: byråns konsult och kundens ägare */
export async function sendEngagement(userId: number, firmId: number, companyId: number, input: { services: string[]; fee: string }, origin: string) {
  const f = await requireFirm(userId, firmId);
  const { client: c, owner, kyc } = await getKyc(userId, firmId, companyId);
  if (!kyc?.next_review) throw new ValidationError('Gör kundkännedomen innan uppdragsbrevet skickas');
  if (kyc.engagement_document_id && kyc.engagement_status !== 'cancelled' && kyc.engagement_status !== 'declined') throw new ConflictError('Uppdragsbrevet är redan skickat');
  if (!owner) throw new ValidationError('Klienten saknar ägare att skicka till');
  const services = [...new Set(input.services)].filter((s): s is EngagementService => s in ENGAGEMENT_SERVICES);
  if (!services.length) throw new ValidationError('Välj vad uppdraget omfattar');
  if (!input.fee.trim()) throw new ValidationError('Ange arvodet');
  const [me] = await sql<{ name: string; email: string }[]>`SELECT name, email FROM users WHERE id = ${userId}`;
  const actor = { companyId, userId, apiKeyId: null, role: 'accountant' as const };
  const html = engagementLetter({ firm: f.name, firmOrgnr: f.orgnr, client: c.name, clientOrgnr: c.orgnr, services, fee: input.fee.slice(0, 1000), start: today(), date: today() });
  const d = await createDocument(actor, { title: `Uppdragsbrev ${f.name} – ${c.name}`, html, message: `Uppdragsbrev från ${f.name}.`, source_module: 'byra',
    signers: [{ name: owner.name, user_id: owner.id }, { name: me.name, email: me.email }] });
  await sendDocument(actor, d.id, origin);
  await sql`UPDATE firm_kyc SET engagement_document_id = ${d.id} WHERE firm_id = ${firmId} AND company_id = ${companyId}`;
  return d.id;
}

/** Byråns översikt: kundkännedom per klient */
export async function firmKycOverview(firmId: number) {
  const rows = await sql<{ company_id: number; risk: Risk | null; next_review: string | null; engagement: string | null }[]>`SELECT k.company_id, k.risk,
      to_char(k.next_review,'YYYY-MM-DD') AS next_review, d.status AS engagement FROM firm_kyc k LEFT JOIN documents d ON d.id = k.engagement_document_id WHERE k.firm_id = ${firmId}`;
  const t = today();
  return new Map(rows.map((r) => [r.company_id, { ...r, status: kycStatus(r.next_review, t) }]));
}

/** Daglig påminnelse till ansvarig konsult (eller byråns ägare) en månad innan kundkännedomen ska göras om */
export async function kycReminders() {
  const rows = await sql<{ firm_id: number; company_id: number; name: string; next: string; to: string[] }[]>`
    SELECT k.firm_id, k.company_id, c.name, to_char(k.next_review,'YYYY-MM-DD') AS next,
      COALESCE((SELECT array_agg(u.email) FROM users u WHERE u.id = fc.responsible),
        (SELECT array_agg(u.email) FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_id = k.firm_id AND m.role = 'owner')) AS to
    FROM firm_kyc k JOIN firm_clients fc ON fc.firm_id = k.firm_id AND fc.company_id = k.company_id JOIN companies c ON c.id = k.company_id
    WHERE k.next_review IS NOT NULL AND k.next_review <= current_date + 30 AND k.reminded_for IS DISTINCT FROM k.next_review`;
  for (const r of rows) {
    for (const to of r.to ?? []) await sendMail(to, `Kundkännedom: ${r.name}`, `Kundkännedomen för ${r.name} ska göras om senast ${r.next} (penningtvättslagen). Öppna byråvyn för att göra en ny bedömning.`);
    await sql`UPDATE firm_kyc SET reminded_for = next_review WHERE firm_id = ${r.firm_id} AND company_id = ${r.company_id}`;
  }
  return rows.length;
}
