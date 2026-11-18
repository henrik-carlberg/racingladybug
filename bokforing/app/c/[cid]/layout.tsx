import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireCompany } from '@/lib/server/auth';
import { ROLE_LABEL } from '@/lib/format';
import { enabledModules } from '@/lib/modules/enabled';
import { companyTodos, urgentCount } from '@/lib/services/todo';
import { deleteDemo } from '@/app/company-actions';

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
            <Link href={`${b}/mitt/schema`}>Schema och stämpling</Link>
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
  const urgent = urgentCount(await companyTodos(company.id, { modules: modules.map((m) => m.id), owner: role === 'owner', userId: user.id }).catch(() => []));
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Link href="/">Bokföring</Link></div>
        <div className="company">{company.name}<br />{user.name} · {ROLE_LABEL[role]}</div>
        <input type="checkbox" id="navtoggle" className="navtoggle" aria-hidden="true" />
        <label htmlFor="navtoggle" className="navbtn btn secondary">☰ Meny</label>
        <nav>
          {role === 'accountant' && <Link href="/byra">← Byråvy</Link>}
          <Link href={b}>Översikt{urgent > 0 && <span className="badge warn" style={{ marginLeft: '.4rem' }} title="Saker som väntar på dig">{urgent}</span>}</Link>
          <Link href={`${b}/kom-igang`}>Kom igång</Link>
          <Link href={`${b}/kvitto`}>📷 Nytt kvitto</Link>
          <Link href={`${b}/deadlines`}>Deadlines</Link>
          <div className="group">Bokföring</div>
          <Link href={`${b}/verifikationer`}>Verifikationer</Link>
          <Link href={`${b}/verifikationer/ny`}>Ny verifikation</Link>
          <Link href={`${b}/konton`}>Kontoplan</Link>
          <div className="group">Försäljning</div>
          <Link href={`${b}/fakturor`}>Kundfakturor</Link>
          <Link href={`${b}/fakturor/rotrut`}>ROT och RUT</Link>
          <Link href={`${b}/kassa`}>Kassa och e-handel</Link>
          <Link href={`${b}/kunder`}>Kunder</Link>
          <Link href={`${b}/tid`}>⏱ Tidrapportering</Link>
          <Link href={`${b}/uppdrag`}>Uppdrag &amp; timbanker</Link>
          <div className="group">Inköp</div>
          <Link href={`${b}/leverantorsfakturor/inkorg`}>Inkorg för fakturor</Link>
          <Link href={`${b}/leverantorsfakturor`}>Leverantörsfakturor</Link>
          <Link href={`${b}/leverantorsfakturor/betalning`}>Betalningar</Link>
          <Link href={`${b}/leverantorer`}>Leverantörer</Link>
          <div className="group">Bank</div>
          <Link href={`${b}/bank`}>Bankkonton</Link>
          <Link href={`${b}/bank/avstamning`}>Bankavstämning</Link>
          <Link href={`${b}/bank/regler`}>Konteringsregler</Link>
          <Link href={`${b}/fragor`}>Frågor och svar</Link>
          <div className="group">Lön</div>
          <Link href={`${b}/lon`}>Lönekörningar</Link>
          <Link href={`${b}/lon/anstallda`}>Anställda</Link>
          <Link href={`${b}/lon/franvaro`}>Frånvaro och semester</Link>
          <Link href={`${b}/schema`}>Schema</Link>
          <Link href={`${b}/personalliggare`}>Personalliggare</Link>
          <Link href={`${b}/lon/skattetabeller`}>Skattetabeller</Link>
          <div className="group">Rapporter</div>
          <Link href={`${b}/rapporter`}>Resultat &amp; balans</Link>
          <Link href={`${b}/rapporter/manad`}>Månadsrapport</Link>
          <Link href={`${b}/assistent`}>Fråga assistenten</Link>
          <Link href={`${b}/rapporter/huvudbok`}>Huvudbok</Link>
          <Link href={`${b}/rapporter/moms`}>Moms</Link>
          <Link href={`${b}/rapporter/eu`}>EU-handel</Link>
          <Link href={`${b}/rapporter/export`}>Export (SIE)</Link>
          <Link href={`${b}/rapporter/dimensioner`}>Resultat per dimension</Link>
          <Link href={`${b}/anlaggningar`}>Anläggningsregister</Link>
          <Link href={`${b}/periodiseringar`}>Periodiseringar</Link>
          <Link href={`${b}/bokslut`}>Bokslut &amp; deklaration</Link>
          {modules.map((m) => (
            <div key={m.id}>
              <div className="group">{m.name}</div>
              {(m.nav ?? [{ label: m.name, path: '' }]).map((n) => <Link key={n.path} href={`${b}/m/${m.id}${n.path ? '/' + n.path : ''}`}>{n.label}</Link>)}
            </div>
          ))}
          <div className="group">Bolaget</div>
          <Link href={`${b}/installningar`}>Inställningar</Link>
          <Link href={`${b}/installningar/gdpr`}>Dataskydd (GDPR)</Link>
          <Link href={`${b}/installningar/betalningar`}>Kortbetalning</Link>
          <Link href={`${b}/installningar/kostnadsstallen`}>Kostnadsställen</Link>
          <Link href={`${b}/installningar/byra`}>Redovisningsbyrå</Link>
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
        {role === 'auditor' && <div className="card small auditor-banner" style={{ borderColor: 'var(--warn)' }}>Du är inloggad som revisor och har läsbehörighet. Du kan inte ändra något i bokföringen.</div>}
        {(company as { is_demo?: boolean }).is_demo && <div className="flash ok no-print demo-banner">Det här är ett demobolag med exempeldata. {role === 'owner' && <form action={deleteDemo.bind(null, company.id)} style={{ display: 'inline' }}><button className="link">Ta bort demobolaget</button></form>}</div>}
        {banner && <div className="flash error no-print">{banner} <Link href={`${b}/abonnemang`}>{role === 'owner' ? 'Starta abonnemang' : 'Se abonnemang'}</Link></div>}
        {children}
      </main>
    </div>
  );
}
