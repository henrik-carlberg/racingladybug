import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { CashChart, Histogram, MonthlyChart } from '@/components/Charts';
import { dashboard } from '@/lib/services/dashboard';

export const dynamic = 'force-dynamic';

const STATUS = { good: { icon: '✓', label: 'Bra', color: 'var(--ok)' }, warning: { icon: '!', label: 'Bevaka', color: 'var(--warn)' }, serious: { icon: '▲', label: 'Svagt', color: 'var(--danger)' } } as const;

export default async function Panel({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const d = await dashboard(company.id);
  const b = `/c/${company.id}`;
  return (
    <div>
      <h1>Instrumentpanel</h1>
      <div className="grid">
        {d.kpis.map((k) => (
          <div key={k.key} className="card stat kpi">
            <div className="label">{k.label}</div>
            <div className="value">{k.value == null ? '–' : `${k.value.toLocaleString('sv-SE')}${k.unit === '%' ? ' %' : ' dagar'}`}</div>
            {k.status && <div className="status" style={{ color: STATUS[k.status].color }}>{STATUS[k.status].icon} {STATUS[k.status].label}</div>}
            <details className="small muted"><summary>Vad betyder det?</summary>{k.explain}</details>
          </div>
        ))}
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Intäkter, kostnader och resultat – 12 månader</h2>
        <MonthlyChart rows={d.monthly} title="Intäkter, kostnader och resultat per månad" />
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Kassa och bank</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Saldo på 19xx vid varje månads slut. Prognosen lägger till kundfakturor och drar av leverantörsfakturor efter förfallodag – se <Link href={`${b}/m/likviditet`}>likviditetsprognosen</Link> för planerade poster som lön och skatt.</p>
        <CashChart actual={d.cash} forecast={d.forecast} title="Kassa och bank per månad med prognos" />
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Kundernas betaltid</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Antal betalda kundfakturor de senaste 12 månaderna efter dagar från fakturadatum till betalning ({d.paidCount} fakturor).</p>
        {d.paidCount ? <Histogram bins={d.bins} title="Fakturor per betaltid i dagar" unit="dagar" /> : <p className="muted">Inga betalda fakturor än.</p>}
      </div>
    </div>
  );
}
