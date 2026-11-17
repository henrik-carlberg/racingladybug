import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireCompany } from '@/lib/server/auth';
import { ROLE_LABEL } from '@/lib/format';

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, role, user } = await requireCompany(cid);
  const b = `/c/${company.id}`;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Link href="/">Bokföring</Link></div>
        <div className="company">{company.name}<br />{user.name} · {ROLE_LABEL[role]}</div>
        <nav>
          <Link href={b}>Översikt</Link>
          <div className="group">Bokföring</div>
          <Link href={`${b}/verifikationer`}>Verifikationer</Link>
          <Link href={`${b}/verifikationer/ny`}>Ny verifikation</Link>
          <Link href={`${b}/konton`}>Kontoplan</Link>
          <div className="group">Försäljning</div>
          <Link href={`${b}/fakturor`}>Kundfakturor</Link>
          <Link href={`${b}/kunder`}>Kunder</Link>
          <div className="group">Inköp</div>
          <Link href={`${b}/leverantorsfakturor`}>Leverantörsfakturor</Link>
          <Link href={`${b}/leverantorsfakturor/betalning`}>Betalningar</Link>
          <Link href={`${b}/leverantorer`}>Leverantörer</Link>
          <div className="group">Lön</div>
          <Link href={`${b}/lon`}>Lönekörningar</Link>
          <Link href={`${b}/lon/anstallda`}>Anställda</Link>
          <Link href={`${b}/lon/skattetabeller`}>Skattetabeller</Link>
          <div className="group">Rapporter</div>
          <Link href={`${b}/rapporter`}>Resultat &amp; balans</Link>
          <Link href={`${b}/rapporter/huvudbok`}>Huvudbok</Link>
          <Link href={`${b}/rapporter/moms`}>Moms</Link>
          <Link href={`${b}/rapporter/export`}>Export (SIE)</Link>
          <div className="group">Bolaget</div>
          <Link href={`${b}/installningar`}>Inställningar</Link>
          <Link href={`${b}/historik`}>Behandlingshistorik</Link>
          <Link href="/">Byt bolag</Link>
        </nav>
      </aside>
      <main>{children}</main>
    </div>
  );
}
