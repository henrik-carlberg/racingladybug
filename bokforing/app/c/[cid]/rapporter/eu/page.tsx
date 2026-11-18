import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { OSS_THRESHOLD, ossSummary, periodicSummary, periodRange } from '@/lib/eu';
import { euLines } from '@/lib/services/eu';

export const dynamic = 'force-dynamic';

export default async function Eu({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const t = today();
  const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1;
  const period = String(sp.period ?? `${t.slice(0, 4)}-Q${q}`);
  const r = periodRange(period) ?? periodRange(`${t.slice(0, 4)}-Q${q}`)!;
  const year = r.from.slice(0, 4);
  const [lines, yearLines] = await Promise.all([euLines(company.id, r.from, r.to), euLines(company.id, `${year}-01-01`, `${year}-12-31`)]);
  const ps = periodicSummary(lines);
  const oss = ossSummary(yearLines);
  const b = `/c/${company.id}`;
  return (
    <div>
      <h1>EU-handel</h1>
      <form className="card row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '0 0 200px' }}>Period (ÅÅÅÅ-MM eller ÅÅÅÅ-Q1)<input name="period" defaultValue={period} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
        <span className="small muted">{r.from} – {r.to}</span>
      </form>

      <h2>Periodisk sammanställning – {r.label}</h2>
      <p className="small muted">Momsfri försäljning av varor (3106/3108) och tjänster (3308) till företag i andra EU-länder, per köparens momsregistreringsnummer, i hela kronor.
        Lämnas till Skatteverket för varje månad (varor) eller kvartal (enbart tjänster) med försäljning – senast den 25:e månaden efter perioden (den 20:e vid pappersblankett).</p>
      {ps.missing.length > 0 && <div className="card small" style={{ borderColor: 'var(--warn)' }}>Saknar momsregistreringsnummer: {ps.missing.join(', ')}. Lägg in det på kunden – annars får försäljningen inte vara momsfri.</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Köparens momsreg.nr</th><th>Kund</th><th className="num">Varor (kr)</th><th className="num">Tjänster (kr)</th></tr></thead>
          <tbody>
            {ps.rows.map((x) => <tr key={x.vatNumber}><td className="mono">{x.vatNumber}</td><td>{x.customer}</td><td className="num">{x.goods.toLocaleString('sv-SE')}</td><td className="num">{x.services.toLocaleString('sv-SE')}</td></tr>)}
            {ps.rows.length === 0 && <tr><td colSpan={4} className="muted">Ingen EU-försäljning till företag i perioden.</td></tr>}
            {ps.rows.length > 0 && <tr className="sum"><td colSpan={2}><b>Summa</b></td><td className="num"><b>{ps.totalGoods.toLocaleString('sv-SE')}</b></td><td className="num"><b>{ps.totalServices.toLocaleString('sv-SE')}</b></td></tr>}
          </tbody>
        </table>
      </div>
      {ps.rows.length > 0 && <p className="small"><a href={`${b}/rapporter/eu/csv?period=${encodeURIComponent(period)}`}>Ladda ner som CSV</a> <span className="muted">– underlag att föra in i Skatteverkets e-tjänst för periodisk sammanställning. Stäm av mot momsdeklarationens ruta 35 och 39.</span></p>}

      <h2>Försäljning till privatpersoner i EU (OSS) – {year}</h2>
      <p className="small muted">Distansförsäljning av varor och e-tjänster till konsumenter i andra EU-länder. Under {kr(OSS_THRESHOLD)} kr per år totalt får svensk moms tas ut. Över tröskeln ska köparlandets moms tas ut, och den redovisas i Skatteverkets e-tjänst för OSS (unionsordningen) per kvartal.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Land</th><th className="num">Försäljning exkl. moms</th></tr></thead>
          <tbody>
            {oss.rows.map((x) => <tr key={x.country}><td>{x.country}</td><td className="num">{kr(x.net)}</td></tr>)}
            {oss.rows.length === 0 && <tr><td colSpan={2} className="muted">Ingen försäljning till privatpersoner i andra EU-länder i år.</td></tr>}
            {oss.rows.length > 0 && <tr className="sum"><td><b>Summa</b></td><td className="num"><b>{kr(oss.total)}</b></td></tr>}
          </tbody>
        </table>
      </div>
      {oss.overThreshold
        ? <div className="card" style={{ borderColor: 'var(--danger)' }}><b>Tröskeln är passerad.</b> Fakturera med köparlandets moms från och med den försäljning som passerade tröskeln och registrera bolaget för OSS hos Skatteverket.</div>
        : oss.total > 0 && <p className="small">{kr(OSS_THRESHOLD - oss.total)} kr kvar till tröskeln.</p>}
      <p className="small"><Link href={`${b}/rapporter/moms`}>Till momsrapporten</Link></p>
    </div>
  );
}
