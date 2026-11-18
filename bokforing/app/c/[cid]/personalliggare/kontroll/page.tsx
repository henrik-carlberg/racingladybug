import { requireCompany } from '@/lib/server/auth';
import { PrintButton } from '@/components/PrintButton';
import { today } from '@/lib/format';
import { listLog, listSites } from '@/lib/services/staff';
import { formatPnr } from '@/lib/rotrut';
import type { SP } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Kontrollvy för Skatteverkets oannonserade kontrollbesök: dagens liggare per arbetsplats med rättelser */
export default async function Inspection({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const d = typeof sp.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : today();
  const sites = await listSites(company.id);
  const entries = await listLog(company.id, { date: d });
  const t = (s: string | null) => (s ? s.slice(11, 16) : '');
  return (
    <div className="doc">
      <div className="header no-print"><span /><PrintButton /></div>
      <h1>Personalliggare {d}</h1>
      <p><b>{company.name}</b>, org.nr {company.orgnr}</p>
      {sites.map((s) => {
        const rows = entries.filter((e) => e.site_id === s.id).sort((a, b) => a.check_in.localeCompare(b.check_in));
        return (
          <section key={s.id} style={{ marginBottom: '1.5rem' }}>
            <h2>{s.name}</h2>{s.address && <p className="small">{s.address}</p>}
            <table className="small">
              <thead><tr><th>Namn</th><th>Personnummer</th><th>Arbetspass börjar</th><th>Arbetspass slutar</th><th>Rättelser</th></tr></thead>
              <tbody>{rows.map((e) => (
                <tr key={e.id}><td>{e.person_name}</td><td className="mono">{formatPnr(e.personal_number)}</td><td>{t(e.check_in)}</td><td>{t(e.check_out)}</td>
                  <td>{e.changes.map((c, i) => <div key={i}>{c.at}: {c.field} {c.old_value ? `${c.old_value.slice(11, 16)} → ` : ''}{c.new_value.slice(11, 16)} – {c.reason} ({c.by})</div>)}</td></tr>
              ))}{rows.length === 0 && <tr><td colSpan={5}>Inga registreringar.</td></tr>}</tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
