import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { KpiTiles } from '@/components/KpiTiles';
import { SharePanel } from '@/components/SharePanel';
import { ROLE_KPIS } from '@/lib/report-builder';
import { kpiView } from '@/lib/services/custom-reports';

export const dynamic = 'force-dynamic';
const ROLES = { vd: 'Vd', ekonomi: 'Ekonomiansvarig', styrelse: 'Styrelse' } as const;

export default async function Kpis({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const role = (Object.keys(ROLES).includes(String(sp.roll)) ? sp.roll : 'vd') as keyof typeof ROLES;
  const k = await kpiView(company.id);
  const b = `/c/${company.id}/nyckeltal`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header">
        <h1>Nyckeltal</h1>
        <div className="actions" style={{ margin: 0 }}>{Object.entries(ROLES).map(([key, l]) => <Link key={key} className={`btn ${role === key ? '' : 'secondary'}`} href={`${b}?roll=${key}`}>{l}</Link>)}</div>
      </div>
      <Flash searchParams={searchParams} />
      <p className="muted">Hittills i år ({k.period}) jämfört med samma period i fjol. <Link href={`/c/${company.id}/rapporter/egna`}>Egna rapporter</Link> · <Link href="/nyckeltal">Jämför dina bolag</Link></p>
      <KpiTiles keys={ROLE_KPIS[role]} now={k.now} prev={k.prev} />
      <p className="small muted">Soliditet = eget kapital (inkl. 79,4 % av obeskattade reserver) / tillgångar. Kassalikviditet = omsättningstillgångar utom lager / kortfristiga skulder. Kundernas betaltid räknas på kundfordringarna och försäljningen inkl. moms.</p>
      <SharePanel companyId={company.id} back={`${b}?roll=${role}`} kind="kpi" role={role} token={typeof sp.delad === 'string' ? sp.delad : null} />
    </div>
  );
}
