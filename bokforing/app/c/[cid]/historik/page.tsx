import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

export default async function History({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const rows = await sql<{ id: number; at: string; user: string | null; action: string; entity: string; entity_id: number | null; details: unknown }[]>`
    SELECT a.id, to_char(a.created_at AT TIME ZONE 'Europe/Stockholm', 'YYYY-MM-DD HH24:MI') AS at,
           u.name || COALESCE(' (API: ' || k.name || ')', '') AS user,
           a.action, a.entity, a.entity_id, a.details
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN api_keys k ON k.id = a.api_key_id WHERE a.company_id = ${company.id} ORDER BY a.id DESC LIMIT 500`;
  return (
    <>
      <h1>Behandlingshistorik</h1>
      <p className="muted small">Logg över vem som gjort vad i bolaget (senaste 500 händelserna).</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Tid</th><th>Användare</th><th>Händelse</th><th>Objekt</th><th>Detaljer</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{r.at}</td><td>{r.user}</td><td>{r.action}</td>
                <td>{r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}</td>
                <td className="small mono">{r.details ? JSON.stringify(r.details) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
