import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { NotFoundError } from '@/lib/errors';
import { today } from '@/lib/format';
import { ReportTable } from '@/components/ReportTable';
import { SharePanel } from '@/components/SharePanel';
import { getReport, runReport } from '@/lib/services/custom-reports';
import { remove, save } from '../actions';

export const dynamic = 'force-dynamic';

export default async function CustomReport({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: SP }) {
  const { cid, id } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const r = await getReport(company.id, Number(id)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const year = Number(sp.ar) >= 2000 && Number(sp.ar) <= 2100 ? Number(sp.ar) : Number(today().slice(0, 4));
  const out = await runReport(company.id, r.definition, year);
  const b = `/c/${company.id}/rapporter/egna/${r.id}`;
  const rows = [...r.definition.rows, ...Array.from({ length: 4 }, () => null)];
  return (
    <div style={{ maxWidth: 1200 }}>
      <div className="header">
        <h1>{r.name}</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`${b}?ar=${year - 1}`}>← {year - 1}</Link>
          <Link className="btn secondary" href={`${b}?ar=${year + 1}`}>{year + 1} →</Link>
          <a className="btn secondary" href={`${b}/xlsx?ar=${year}`}>Excel</a>
          <Link className="btn secondary" href={`/c/${company.id}/rapporter/egna`}>Alla rapporter</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <ReportTable columns={out.columns} rows={out.rows} budget={out.hasBudget} />

      <SharePanel companyId={company.id} back={b} kind="report" reportId={r.id} token={typeof sp.delad === 'string' ? sp.delad : null} />

      <h2>Anpassa rapporten</h2>
      <form action={save.bind(null, company.id, r.id)} className="card stack report-editor">
        <label>Namn<input name="name" defaultValue={r.name} required /></label>
        <div className="row">
          <label>Kolumner<select name="columns" defaultValue={r.definition.columns}><option value="year">Hittills i år</option><option value="quarters">Per kvartal</option><option value="months">Per månad</option></select></label>
          <label className="check"><input type="checkbox" name="compare" defaultChecked={r.definition.compare} /> Jämför med i fjol</label>
          <label className="check"><input type="checkbox" name="budget" defaultChecked={r.definition.budget} /> Visa budget (hittills i år)</label>
        </div>
        <table>
          <thead><tr><th style={{ width: 50 }}>Rad</th><th>Rubrik (slutar den med % visas procent)</th><th style={{ width: 150 }}>Typ</th><th>Konton (t.ex. 3000-3999, -4010) eller formel (t.ex. r1 - r2)</th><th>Fet</th></tr></thead>
          <tbody>{rows.map((x, i) => (
            <tr key={i}>
              <td className="mono">r{i + 1}</td>
              <td><input name={`label_${i}`} defaultValue={x?.label ?? ''} aria-label={`Rubrik rad ${i + 1}`} /></td>
              <td><select name={`type_${i}`} defaultValue={x?.type ?? 'accounts'} aria-label={`Typ rad ${i + 1}`}><option value="accounts">Konton</option><option value="formula">Formel</option><option value="heading">Rubrik</option></select></td>
              <td><input name={`value_${i}`} defaultValue={x?.value ?? ''} className="mono" aria-label={`Konton eller formel rad ${i + 1}`} /></td>
              <td><input type="checkbox" name={`bold_${i}`} defaultChecked={!!x?.bold} aria-label={`Fet rad ${i + 1}`} /></td>
            </tr>
          ))}</tbody>
        </table>
        <p className="small muted" style={{ margin: 0 }}>Kontorader under 3000 visar saldot vid periodens slut, övriga periodens belopp. Intäkter, skulder och eget kapital visas som positiva tal. Formler räknar med raderna ovanför: + − * / och parenteser.</p>
        <div className="actions" style={{ margin: 0 }}><button>Spara rapporten</button></div>
      </form>
      <form action={remove.bind(null, company.id, r.id)}><button className="link">Ta bort rapporten</button></form>
    </div>
  );
}
