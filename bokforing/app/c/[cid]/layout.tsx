import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireCompany } from '@/lib/server/auth';
import { ROLE_LABEL } from '@/lib/format';
import { enabledModules } from '@/lib/modules/enabled';

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, role, user, billing } = await requireCompany(cid, { employee: true, allowLocked: true });
  const b = `/c/${company.id}`;
  const modules = await enabledModules(company.id);
  const banner = billing.state === 'trial' && (billing.daysLeft ?? 99) <= 14 ? `Provperioden slutar om ${billing.daysLeft} dagar.`
    : billing.state === 'past_due' ? 'Senaste betalningen gick inte igenom.' : null;
  if (role === 'employee') {
    return (
      <div className="shell">
        <aside className="side">
          <div className="brand"><Link href="/">Bokföring</Link></div>
          <div className="company">{company.name}<br />{user.name} · {ROLE_LABEL[role]}</div>
          <input type="checkbox" id="navtoggle" className="navtoggle" aria-hidden="true" />
          <label htmlFor="navtoggle" className="navbtn btn secondary">☰ Meny</label>
          <nav>
            <Link href={`${b}/mitt`}>Min sida</Link>
            <Link href={`${b}/tid`}>⏱ Tidrapport</Link>
            {modules.some((m) => m.id === 'utlagg') && <Link href={`${b}/m/utlagg`}>Utlägg och resor</Link>}
            <Link href={`${b}/mitt/franvaro`}>Frånvaro och semester</Link>
            <Link href={`${b}/mitt/lon`}>Lönespecifikationer</Link>
            <div className="group">Konto</div>
            <Link href="/konto">Mitt konto</Link>
            <Link href="/">Byt bolag</Link>
          </nav>
        </aside>
        <main>{children}</main>
      </div>
    );
  }
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Link href="/">Bokföring</Link></div>
        <div className="company">{company.name}<br />{user.name} · {ROLE_LABEL[role]}</div>
        <input type="checkbox" id="navtoggle" className="navtoggle" aria-hidden="true" />
        <label htmlFor="navtoggle" className="navbtn btn secondary">☰ Meny</label>
        <nav>
          <Link href={b}>Översikt</Link>
          <Link href={`${b}/kom-igang`}>Kom igång</Link>
          <Link href={`${b}/kvitto`}>📷 Nytt kvitto</Link>
          <Link href={`${b}/deadlines`}>Deadlines</Link>
          <div className="group">Bokföring</div>
          <Link href={`${b}/verifikationer`}>Verifikationer</Link>
          <Link href={`${b}/verifikationer/ny`}>Ny verifikation</Link>
          <Link href={`${b}/konton`}>Kontoplan</Link>
          <div className="group">Försäljning</div>
          <Link href={`${b}/fakturor`}>Kundfakturor</Link>
          <Link href={`${b}/kunder`}>Kunder</Link>
          <Link href={`${b}/tid`}>⏱ Tidrapportering</Link>
          <Link href={`${b}/uppdrag`}>Uppdrag &amp; timbanker</Link>
          <div className="group">Inköp</div>
          <Link href={`${b}/leverantorsfakturor`}>Leverantörsfakturor</Link>
          <Link href={`${b}/leverantorsfakturor/betalning`}>Betalningar</Link>
          <Link href={`${b}/leverantorer`}>Leverantörer</Link>
          <div className="group">Bank</div>
          <Link href={`${b}/bank`}>Bankkonton</Link>
          <Link href={`${b}/bank/avstamning`}>Bankavstämning</Link>
          <div className="group">Lön</div>
          <Link href={`${b}/lon`}>Lönekörningar</Link>
          <Link href={`${b}/lon/anstallda`}>Anställda</Link>
          <Link href={`${b}/lon/franvaro`}>Frånvaro och semester</Link>
          <Link href={`${b}/lon/skattetabeller`}>Skattetabeller</Link>
          <div className="group">Rapporter</div>
          <Link href={`${b}/rapporter`}>Resultat &amp; balans</Link>
          <Link href={`${b}/rapporter/huvudbok`}>Huvudbok</Link>
          <Link href={`${b}/rapporter/moms`}>Moms</Link>
          <Link href={`${b}/rapporter/export`}>Export (SIE)</Link>
          <Link href={`${b}/bokslut`}>Bokslut &amp; deklaration</Link>
          {modules.map((m) => (
            <div key={m.id}>
              <div className="group">{m.name}</div>
              {(m.nav ?? [{ label: m.name, path: '' }]).map((n) => <Link key={n.path} href={`${b}/m/${m.id}${n.path ? '/' + n.path : ''}`}>{n.label}</Link>)}
            </div>
          ))}
          <div className="group">Bolaget</div>
          <Link href={`${b}/installningar`}>Inställningar</Link>
          <Link href={`${b}/dokument`}>Dokument &amp; e-signering</Link>
          <Link href={`${b}/moduler`}>Moduler</Link>
          <Link href={`${b}/abonnemang`}>Abonnemang</Link>
          <Link href={`${b}/integrationer`}>Integrationer (API)</Link>
          <Link href={`${b}/historik`}>Behandlingshistorik</Link>
          <Link href="/">Byt bolag</Link>
          <Link href="/konto">Mitt konto</Link>
        </nav>
      </aside>
      <main>
        {banner && <div className="flash error no-print">{banner} <Link href={`${b}/abonnemang`}>{role === 'owner' ? 'Starta abonnemang' : 'Se abonnemang'}</Link></div>}
        {children}
      </main>
    </div>
  );
}
