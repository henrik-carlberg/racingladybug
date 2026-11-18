import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireCompany } from '@/lib/server/auth';
import { canView, type Permission } from '@/lib/permissions';
import { translator } from '@/lib/ui-i18n';
import { uiLang } from '@/lib/server/lang';
import { ROLE_LABEL } from '@/lib/format';
import { enabledModules } from '@/lib/modules/enabled';
import { companyTodos, urgentCount } from '@/lib/services/todo';
import { deleteDemo } from '@/app/company-actions';

export default async function CompanyLayout({ children, params }: { children: ReactNode; params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company, role, user, billing, permissions } = await requireCompany(cid, { employee: true, allowLocked: true });
  const see = (p: Permission) => canView(role, permissions, p);
  const t = translator(await uiLang());
  const b = `/c/${company.id}`;
  const modules = await enabledModules(company.id);
  const banner = billing.state === 'trial' && (billing.daysLeft ?? 99) <= 14 ? `Provperioden slutar om ${billing.daysLeft} dagar.`
    : billing.state === 'past_due' ? 'Senaste betalningen gick inte igenom.' : null;
  if (role === 'employee') {
    return (
      <div className="shell">
        <aside className="side">
          <div className="brand"><Link href="/">{t('Bokföring')}</Link></div>
          <div className="company">{company.name}<br />{user.name} · {t(ROLE_LABEL[role])}</div>
          <input type="checkbox" id="navtoggle" className="navtoggle" aria-label={t('☰ Meny')} />
          <label htmlFor="navtoggle" className="navbtn btn secondary">{t('☰ Meny')}</label>
          <nav>
            <Link href={`${b}/mitt`}>{t('Min sida')}</Link>
            <Link href={`${b}/tid`}>{t('⏱ Tidrapport')}</Link>
            {modules.some((m) => m.id === 'utlagg') && <Link href={`${b}/m/utlagg`}>{t('Utlägg och resor')}</Link>}
            <Link href={`${b}/mitt/franvaro`}>{t('Frånvaro och semester')}</Link>
            <Link href={`${b}/mitt/schema`}>{t('Schema och stämpling')}</Link>
            <Link href={`${b}/mitt/lon`}>{t('Lönespecifikationer')}</Link>
            <div className="group">{t('Konto')}</div>
            <Link href="/konto">{t('Mitt konto')}</Link>
            <Link href="/">{t('Byt bolag')}</Link>
          </nav>
        </aside>
        <main id="main">{children}</main>
      </div>
    );
  }
  const urgent = urgentCount(await companyTodos(company.id, { modules: modules.map((m) => m.id), owner: role === 'owner', userId: user.id }).catch(() => []));
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Link href="/">{t('Bokföring')}</Link></div>
        <div className="company">{company.name}<br />{user.name} · {t(ROLE_LABEL[role])}</div>
        <input type="checkbox" id="navtoggle" className="navtoggle" aria-label={t('☰ Meny')} />
        <label htmlFor="navtoggle" className="navbtn btn secondary">{t('☰ Meny')}</label>
        <nav>
          {role === 'accountant' && <Link href="/byra">{t('← Byråvy')}</Link>}
          <Link href={b}>{t('Översikt')}{urgent > 0 && <span className="badge warn" style={{ marginLeft: '.4rem' }} title={t('Saker som väntar på dig')}>{urgent}</span>}</Link>
          <Link href={`${b}/kom-igang`}>{t('Kom igång')}</Link>
          <Link href={`${b}/kvitto`}>{t('📷 Nytt kvitto')}</Link>
          <Link href={`${b}/deadlines`}>{t('Deadlines')}</Link>
          <div className="group">{t('Bokföring')}</div>
          {see('ledger') && <Link href={`${b}/verifikationer`}>{t('Verifikationer')}</Link>}
          {see('ledger') && <Link href={`${b}/verifikationer/ny`}>{t('Ny verifikation')}</Link>}
          <Link href={`${b}/konton`}>{t('Kontoplan')}</Link>
          <div className="group">{t('Försäljning')}</div>
          {see('invoicing') && <Link href={`${b}/fakturor`}>{t('Kundfakturor')}</Link>}
          {see('invoicing') && <Link href={`${b}/fakturor/rotrut`}>{t('ROT och RUT')}</Link>}
          <Link href={`${b}/kassa`}>{t('Kassa och e-handel')}</Link>
          {see('invoicing') && <Link href={`${b}/kunder`}>{t('Kunder')}</Link>}
          <Link href={`${b}/tid`}>{t('⏱ Tidrapportering')}</Link>
          <Link href={`${b}/uppdrag`}>{t('Uppdrag & timbanker')}</Link>
          <div className="group">{t('Inköp')}</div>
          {see('purchasing') && <Link href={`${b}/leverantorsfakturor/inkorg`}>{t('Inkorg för fakturor')}</Link>}
          {see('purchasing') && <Link href={`${b}/leverantorsfakturor`}>{t('Leverantörsfakturor')}</Link>}
          {see('payments') && <Link href={`${b}/leverantorsfakturor/betalning`}>{t('Betalningar')}</Link>}
          <Link href={`${b}/leverantorer`}>{t('Leverantörer')}</Link>
          <div className="group">{t('Bank')}</div>
          {see('ledger') && <Link href={`${b}/bank`}>{t('Bankkonton')}</Link>}
          {see('ledger') && <Link href={`${b}/bank/avstamning`}>{t('Bankavstämning')}</Link>}
          {see('ledger') && <Link href={`${b}/bank/regler`}>{t('Konteringsregler')}</Link>}
          {see('ledger') && <Link href={`${b}/skattekonto`}>{t('Skattekontot')}</Link>}
          <Link href={`${b}/fragor`}>{t('Frågor och svar')}</Link>
          <div className="group">{t('Lön')}</div>
          {see('payroll') && <Link href={`${b}/lon`}>{t('Lönekörningar')}</Link>}
          {see('payroll') && <Link href={`${b}/lon/anstallda`}>{t('Anställda')}</Link>}
          {see('payroll') && <Link href={`${b}/lon/franvaro`}>{t('Frånvaro och semester')}</Link>}
          <Link href={`${b}/schema`}>{t('Schema')}</Link>
          <Link href={`${b}/personalliggare`}>{t('Personalliggare')}</Link>
          {see('payroll') && <Link href={`${b}/lon/skattetabeller`}>{t('Skattetabeller')}</Link>}
          {see('payroll') && <Link href={`${b}/lon/bilforman`}>{t('Bilförmån')}</Link>}
          <div className="group">{t('Rapporter')}</div>
          <Link href={`${b}/rapporter/panel`}>{t('Instrumentpanel')}</Link>
          <Link href={`${b}/rapporter`}>{t('Resultat & balans')}</Link>
          <Link href={`${b}/rapporter/manad`}>{t('Månadsrapport')}</Link>
          <Link href={`${b}/rapporter/budget`}>{t('Budget')}</Link>
          <Link href={`${b}/assistent`}>{t('Fråga assistenten')}</Link>
          <Link href={`${b}/rapporter/huvudbok`}>{t('Huvudbok')}</Link>
          <Link href={`${b}/rapporter/moms`}>{t('Moms')}</Link>
          <Link href={`${b}/rapporter/eu`}>{t('EU-handel')}</Link>
          <Link href={`${b}/rapporter/export`}>{t('Export (SIE)')}</Link>
          <Link href={`${b}/rapporter/dimensioner`}>{t('Resultat per dimension')}</Link>
          <Link href={`${b}/anlaggningar`}>{t('Anläggningsregister')}</Link>
          <Link href={`${b}/periodiseringar`}>{t('Periodiseringar')}</Link>
          {see('ledger') && <Link href={`${b}/bokslut`}>{t('Bokslut & deklaration')}</Link>}
          {modules.map((m) => (
            <div key={m.id}>
              <div className="group">{m.name}</div>
              {(m.nav ?? [{ label: m.name, path: '' }]).map((n) => <Link key={n.path} href={`${b}/m/${m.id}${n.path ? '/' + n.path : ''}`}>{n.label}</Link>)}
            </div>
          ))}
          <div className="group">{t('Bolaget')}</div>
          <Link href={`${b}/installningar`}>{t('Inställningar')}</Link>
          <Link href={`${b}/installningar/gdpr`}>{t('Dataskydd (GDPR)')}</Link>
          <Link href={`${b}/installningar/betalningar`}>{t('Kortbetalning')}</Link>
          <Link href={`${b}/installningar/kostnadsstallen`}>{t('Kostnadsställen')}</Link>
          <Link href={`${b}/installningar/byra`}>{t('Redovisningsbyrå')}</Link>
          <Link href={`${b}/dokument`}>{t('Dokument & e-signering')}</Link>
          <Link href={`${b}/moduler`}>{t('Moduler')}</Link>
          <Link href={`${b}/abonnemang`}>{t('Abonnemang')}</Link>
          <Link href={`${b}/integrationer`}>{t('Integrationer (API)')}</Link>
          <Link href={`${b}/historik`}>{t('Behandlingshistorik')}</Link>
          <Link href="/">{t('Byt bolag')}</Link>
          <Link href="/konto">{t('Mitt konto')}</Link>
        </nav>
      </aside>
      <main id="main">
        {role === 'auditor' && <div className="card small auditor-banner" style={{ borderColor: 'var(--warn)' }}>Du är inloggad som revisor och har läsbehörighet. Du kan inte ändra något i bokföringen.</div>}
        {(company as { is_demo?: boolean }).is_demo && <div className="flash ok no-print demo-banner">Det här är ett demobolag med exempeldata. {role === 'owner' && <form action={deleteDemo.bind(null, company.id)} style={{ display: 'inline' }}><button className="link">Ta bort demobolaget</button></form>}</div>}
        {banner && <div className="flash error no-print">{banner} <Link href={`${b}/abonnemang`}>{role === 'owner' ? 'Starta abonnemang' : 'Se abonnemang'}</Link></div>}
        {children}
      </main>
    </div>
  );
}
