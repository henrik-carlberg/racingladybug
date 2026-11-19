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
import { buildNav, createActions } from '@/lib/nav';
import { CommandPalette, CreateMenu, SideNav, UsageTracker } from '@/components/AppNav';
import { usageScores } from '@/lib/services/usage';

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
  const nav = buildNav({ base: b, see, t, modules });
  const extra = [
    ...(role === 'accountant' ? [{ href: '/byra', label: t('← Byråvy') }] : []),
    { href: '/', label: t('Byt bolag') }, { href: '/konto', label: t('Mitt konto') },
  ];
  const create = createActions(b, see, t);
  // Vad användaren gör oftast (adresser relativt bolaget → hela adresser)
  const scores = Object.fromEntries(Object.entries(await usageScores(user.id, company.id).catch(() => ({}))).filter(([p]) => p !== '').map(([p, s]) => [b + p, s]));
  const allPages = [...nav.top, ...nav.sections.flatMap((x) => x.items.map((i) => ({ ...i, hint: i.hint ? `${x.label} · ${i.hint}` : x.label }))), ...extra];
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Link href="/"><span className="logo" aria-hidden="true">B</span>{t('Bokföring')}</Link></div>
        <div className="company"><b>{company.name}</b><span>{user.name} · {t(ROLE_LABEL[role])}</span></div>
        <input type="checkbox" id="navtoggle" className="navtoggle" aria-label={t('☰ Meny')} />
        <label htmlFor="navtoggle" className="navbtn btn secondary">{t('☰ Meny')}</label>
        <SideNav top={nav.top} sections={nav.sections} badge={urgent} extra={extra} />
        <UsageTracker />
      </aside>
      <div className="workspace">
        <header className="topbar no-print">
          <CommandPalette items={allPages} create={create} placeholder={t('Sök eller gå till…')} createLabel={t('Skapa')} scores={scores} frequentLabel={t('Ofta')} />
          {create.length > 0 && <CreateMenu items={create} label={t('Skapa')} scores={scores} quickTitle={t('Det du skapar oftast')} />}
        </header>
        <main id="main">
          {role === 'auditor' && <div className="card small auditor-banner" style={{ borderColor: 'var(--warn)' }}>Du är inloggad som revisor och har läsbehörighet. Du kan inte ändra något i bokföringen.</div>}
          {(company as { is_demo?: boolean }).is_demo && <div className="flash ok no-print demo-banner">Det här är ett demobolag med exempeldata. {role === 'owner' && <form action={deleteDemo.bind(null, company.id)} style={{ display: 'inline' }}><button className="link">Ta bort demobolaget</button></form>}</div>}
          {banner && <div className="flash error no-print">{banner} <Link href={`${b}/abonnemang`}>{role === 'owner' ? 'Starta abonnemang' : 'Se abonnemang'}</Link></div>}
          {children}
        </main>
      </div>
    </div>
  );
}
