import { sql } from '@/lib/db';

const ACTION: Record<string, string> = {
  create: 'Skapad', create_draft: 'Utkast skapat', update: 'Ändrad', update_draft: 'Utkast ändrat', book: 'Bokförd', send: 'Skickad', share_link: 'Länk skapad',
  paid: 'Betald', partly_paid: 'Delbetald', credit: 'Krediterad', approve: 'Attesterad', approve_partial: 'Första attest', pay: 'Betald', register: 'Registrerad',
  delete: 'Borttagen', delete_draft: 'Utkast borttaget', settle_advance: 'Förskott avräknat', reverse: 'Rättad', attach: 'Underlag bifogat', remind: 'Påminnelse',
};
const FIELD: Record<string, string> = {
  name: 'namn', email: 'e-post', address: 'adress', postal_code: 'postnummer', city: 'ort', country: 'land', orgnr: 'org.nr', vat_number: 'momsnr',
  payment_terms: 'villkor', reverse_charge: 'omvänd moms', currency: 'valuta', language: 'språk', monthly_salary: 'månadslön', tax_table: 'skattetabell',
  bank_account: 'bankkonto', bank_clearing: 'clearing', pension_percent: 'tjänstepension', car_benefit: 'bilförmån', active: 'aktiv', title: 'befattning',
};
const show = (v: unknown) => (v === null || v === '' ? '–' : v === true ? 'ja' : v === false ? 'nej' : String(v));

/** Ändringshistorik för en post ur behandlingshistoriken (audit_log) */
export async function History({ companyId, entity, id }: { companyId: number; entity: string; id: number }) {
  const rows = await sql<{ action: string; at: string; who: string | null; api: boolean; details: Record<string, unknown> | null }[]>`
    SELECT a.action, to_char(a.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD HH24:MI') AS at, u.name AS who, a.api_key_id IS NOT NULL AS api, a.details
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.company_id = ${companyId} AND a.entity = ${entity} AND a.entity_id = ${id} ORDER BY a.created_at DESC, a.id DESC LIMIT 50`;
  if (!rows.length) return null;
  return (
    <details className="card small history">
      <summary>Historik ({rows.length})</summary>
      <table style={{ marginTop: '.4rem' }}><tbody>
        {rows.map((r, i) => {
          const ch = r.details && typeof r.details === 'object' && 'changes' in r.details ? (r.details.changes as Record<string, [unknown, unknown]>) : null;
          return (
            <tr key={i}>
              <td style={{ whiteSpace: 'nowrap' }}>{r.at}</td>
              <td>{ACTION[r.action] ?? r.action}</td>
              <td>{r.who ?? ''}{r.api ? ' (API)' : ''}</td>
              <td>{ch ? Object.entries(ch).map(([k, [a, b]]) => `${FIELD[k] ?? k}: ${show(a)} → ${show(b)}`).join('; ') : ''}</td>
            </tr>
          );
        })}
      </tbody></table>
    </details>
  );
}
