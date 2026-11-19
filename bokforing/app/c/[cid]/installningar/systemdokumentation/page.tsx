import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { PrintButton } from '@/components/PrintButton';
import { SysDocView } from '@/components/SysDocView';
import { systemDocumentation } from '@/lib/services/sysdoc';

export const dynamic = 'force-dynamic';

export default async function SystemDoc({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger', allowLocked: true });
  const d = await systemDocumentation(company.id);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 960 }}>
      <div className="header no-print"><span /><div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={`${b}/installningar/integritet`}>Integritetskontroll</Link><PrintButton /></div></div>
      <section className="card no-print">
        <h2 style={{ marginTop: 0 }}>Arkivpaket</h2>
        <p className="small" style={{ marginTop: 0 }}>Alla verifikationer med underlag, SIE-fil, register och den här dokumentationen i en fil med kontrollsummor. Spara den i sju år efter räkenskapsårets slut, eller lämna den till revisorn.</p>
        <div className="actions" style={{ margin: 0 }}>{d.years.map((y) => <a key={y.id} className="btn secondary" href={`${b}/arkiv/${y.id}`} download>Arkiv {y.start.slice(0, 4) === y.end.slice(0, 4) ? y.start.slice(0, 4) : `${y.start} – ${y.end}`} ({y.vouchers} ver.)</a>)}</div>
      </section>
      <SysDocView d={d} />
    </div>
  );
}
