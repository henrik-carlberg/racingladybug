import 'server-only';
import { sql } from '@/lib/db';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

/**
 * Organisationsnumret på ett bolag är bara en uppgift som användaren skrivit in. Innan bolaget får skicka och ta emot e-faktura
 * via Peppol eller lämna in direkt till Skatteverket och Bolagsverket (med tjänstens egna avtal) måste den som driver tjänsten
 * ha kontrollerat att användaren företräder bolaget (t.ex. firmatecknare enligt Bolagsverket, BankID eller fullmakt).
 */
export async function isVerified(companyId: number) {
  const [c] = await sql<{ v: boolean }[]>`SELECT identity_verified_at IS NOT NULL AS v FROM companies WHERE id = ${companyId}`;
  return !!c?.v;
}
export async function requireVerified(companyId: number, what: string) {
  if (!(await isVerified(companyId))) throw new ValidationError(`${what} kräver att bolagets organisationsnummer är verifierat. Verifiera bolaget med BankID under Inställningar → Verifiera bolaget.`);
}

export async function setVerified(opsUserId: number, companyId: number, on: boolean, method: 'manual' | 'bankid' = 'manual') {
  try {
    const r = await sql`UPDATE companies SET identity_verified_at = ${on ? new Date() : null}, identity_verified_by = ${on ? opsUserId : null}, identity_method = ${on ? method : null}
      WHERE id = ${companyId} AND NOT is_demo RETURNING id`;
    if (!r.length) throw new NotFoundError('Bolaget');
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ConflictError('Ett annat bolag med samma organisationsnummer är redan verifierat');
    throw e;
  }
  await sql`INSERT INTO audit_log (company_id, user_id, action, entity, entity_id, details) VALUES (${companyId}, ${opsUserId}, ${on ? `verify_identity_${method}` : 'unverify_identity'}, 'company', ${companyId}, ${sql.json({} as never)})`.catch(() => {});
}

export async function findCompanies(q: string) {
  const digits = q.replace(/\D/g, '');
  if (digits.length < 6 && q.trim().length < 3) return [];
  return [...await sql<{ id: number; name: string; orgnr: string; verified: string | null; owner: string | null; created: string }[]>`
    SELECT c.id, c.name, c.orgnr, to_char(c.identity_verified_at,'YYYY-MM-DD') AS verified, to_char(c.created_at,'YYYY-MM-DD') AS created,
      (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = c.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner
    FROM companies c WHERE NOT c.is_demo AND (${digits.length >= 6 ? sql`regexp_replace(c.orgnr, '\\D', '', 'g') LIKE ${'%' + digits + '%'}` : sql`c.name ILIKE ${'%' + q.trim() + '%'}`})
    ORDER BY c.identity_verified_at IS NULL, c.created_at LIMIT 30`];
}
