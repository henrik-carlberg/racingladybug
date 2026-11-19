import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { listReports, TEMPLATES } from '@/lib/services/custom-reports';
import { createFromTemplate } from './actions';

export const dynamic = 'force-dynamic';

export default async function CustomReports({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const list = await listReports(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="header"><h1>Egna rapporter</h1><Link className="btn secondary" href={`${b}/nyckeltal`}>Nyckeltal</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">Bygg rapporter med de rader du vill se: kontointervall, summeringar och formler, per månad, kvartal eller år, med jämförelse mot i fjol och budget. Spara dem som mallar och dela dem med banken eller styrelsen.</p>
      {list.length === 0 ? <EmptyState icon="chart" title="Inga egna rapporter än">Börja från en mall nedan och anpassa raderna.</EmptyState> : (
        <table><tbody>{list.map((r) => <tr key={r.id}><td><Link href={`${b}/rapporter/egna/${r.id}`}>{r.name}</Link></td><td className="small muted">ändrad {r.updated}</td></tr>)}</tbody></table>
      )}
      <form action={createFromTemplate.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
        <label>Mall<select name="template">{Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</select></label>
        <label style={{ flex: '2 1 240px' }}>Namn (valfritt)<input name="name" placeholder="T.ex. Månadsrapport till styrelsen" /></label>
        <div style={{ flex: '0 0 auto' }}><button>Skapa rapport</button></div>
      </form>
    </div>
  );
}
