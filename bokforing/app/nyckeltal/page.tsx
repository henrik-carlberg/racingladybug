import Link from 'next/link';
import { allowedCompanies, requireUser } from '@/lib/server/auth';
import { kr } from '@/lib/format';
import { KPI_LABEL, PCT_KPIS, type Kpis } from '@/lib/report-builder';
import { compareCompanies } from '@/lib/services/custom-reports';

export const dynamic = 'force-dynamic';
const KEYS: (keyof Kpis)[] = ['revenue', 'grossMargin', 'operatingMargin', 'result', 'cash', 'equityRatio', 'quickRatio', 'dso'];
const show = (k: keyof Kpis, v: number | null) => (v == null ? '–' : PCT_KPIS.includes(k) ? `${v.toLocaleString('sv-SE')} %` : k === 'dso' ? `${v} d` : kr(v));

/** Nyckeltal för användarens bolag sida vid sida – för ägare med flera bolag och byråer */
export default async function Compare() {
  const user = await requireUser();
  const list = await allowedCompanies(await compareCompanies(user.id));
  return (
    <div className="center" style={{ maxWidth: 1200 }}>
      <div className="header"><h1>Jämför bolag</h1><Link className="btn secondary" href="/">Mina bolag</Link></div>
      <p className="muted">Hittills i år för de bolag du är ägare, konsult eller revisor i, och byråns klienter.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Bolag</th>{KEYS.map((k) => <th key={k} className="num">{KPI_LABEL[k]}</th>)}</tr></thead>
        <tbody>{list.map((c) => <tr key={c.id}><td><Link href={`/c/${c.id}/nyckeltal`}>{c.name}</Link></td>{KEYS.map((k) => <td key={k} className="num">{show(k, c.now[k])}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  );
}
