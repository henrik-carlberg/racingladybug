import { translator } from '@/lib/ui-i18n';
import { uiLang } from '@/lib/server/lang';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { currentSession, currentUser } from '@/lib/server/auth';
import { Landing } from '@/components/Landing';
import { createCompany, createDemo } from './company-actions';
import { logout } from './auth-actions';
import { Flash, type SP } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const user = await currentUser();
  const L = translator(await uiLang());
  if (!user) {
    // SSO-session: gäller bara bolaget som företagsinloggningen gjordes för
    const s = await currentSession();
    if (s?.method === 'sso' && s.ssoCompanyId) {
      const [c] = await sql<{ name: string }[]>`SELECT name FROM companies WHERE id = ${s.ssoCompanyId}`;
      return (
        <div className="center" style={{ maxWidth: 720 }}>
          <h1>{c?.name}</h1>
          <Flash searchParams={searchParams} />
          <p>Du är inloggad med företagets inloggning (SSO) för {c?.name}. Den inloggningen gäller bara det bolaget.</p>
          <div className="actions"><Link className="btn" href={`/c/${s.ssoCompanyId}`}>Öppna {c?.name}</Link><form action={logout}><button className="secondary">Logga ut</button></form></div>
        </div>
      );
    }
    return <Landing />;
  }
  const companies = await sql<{ id: number; name: string; orgnr: string; role: 'owner' | 'accountant' | 'employee' | 'auditor' }[]>`
    SELECT c.id, c.name, c.orgnr, m.role FROM companies c JOIN memberships m ON m.company_id = c.id
    WHERE m.user_id = ${user.id} ORDER BY c.name`;
  const firms = await sql<{ id: number; name: string }[]>`SELECT f.id, f.name FROM firms f JOIN firm_members m ON m.firm_id = f.id WHERE m.user_id = ${user.id}`;
  const clients = await sql<{ id: number; name: string; orgnr: string; firm: string }[]>`
    SELECT DISTINCT ON (c.id) c.id, c.name, c.orgnr, f.name AS firm FROM firm_clients fc JOIN firm_members m ON m.firm_id = fc.firm_id JOIN firms f ON f.id = fc.firm_id
    JOIN companies c ON c.id = fc.company_id WHERE m.user_id = ${user.id} AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.company_id = c.id AND x.user_id = ${user.id}) ORDER BY c.id`;
  const year = new Date().getFullYear();
  const [{ n: passkeys }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM passkeys WHERE user_id = ${user.id}`;
  return (
    <div className="center" style={{ maxWidth: 720 }}>
      <div className="header">
        <h1>{L("Mina bolag")}</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href="/byra">{firms.length ? 'Byråvy' : 'För byråer'}</Link>
          {companies.filter((c) => c.role !== 'employee').length > 1 && <Link className="btn secondary" href="/koncern">{L("Koncern")}</Link>}
          <Link className="btn secondary" href="/konto">{L("Mitt konto")}</Link>
          <form action={logout}><button className="secondary">Logga ut ({user.name})</button></form>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      {passkeys === 0 && (
        <div className="card small">{L("🔑 Logga in snabbare och säkrare:")} <Link href="/konto">{L("lägg till en passkey")}</Link>.</div>
      )}
      {companies.length > 0 && (
        <table>
          <thead><tr><th>{L("Bolag")}</th><th>{L("Org.nr")}</th><th>{L("Roll")}</th></tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}><td><Link href={`/c/${c.id}`}>{c.name}</Link></td><td>{c.orgnr}</td><td>{L(ROLE_LABEL[c.role])}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {clients.length > 0 && (
        <>
          <h2>{L("Klienter via byrå")}</h2>
          <table><tbody>{clients.map((c) => <tr key={c.id}><td><Link href={`/c/${c.id}`}>{c.name}</Link></td><td>{c.orgnr}</td><td className="small muted">{c.firm}</td></tr>)}</tbody></table>
        </>
      )}
      {companies.length === 0 && (
        <div className="card row" style={{ alignItems: 'center' }}>
          <div style={{ flex: '1 1 300px' }}><b>{L("Vill du prova först?")}</b><div className="small muted">{L("Ett demobolag med kunder, fakturor, leverantörer, bank och en anställd. Det kostar ingenting och kan tas bort.")}</div></div>
          <form action={createDemo} style={{ flex: '0 0 auto' }}><button className="secondary">{L("Skapa demobolag")}</button></form>
        </div>
      )}
      <h2>{L("Lägg upp nytt bolag")}</h2>
      <form action={createCompany} className="card stack">
        <label>{L("Företagsnamn")}<input name="name" required /></label>
        <div className="row">
          <label>Bolagsform
            <select name="company_type"><option value="AB">{L("Aktiebolag (AB)")}</option><option value="EF">{L("Enskild firma (enskild näringsidkare)")}</option></select>
          </label>
          <label>{L("Org.nr (AB) / personnummer (EF)")}<input name="orgnr" required placeholder="556677-8899" /></label>
        </div>
        <div className="row">
          <label>{L("Räkenskapsåret börjar")}<input name="fy_start" type="date" defaultValue={`${year}-01-01`} required /></label>
          <label>{L("och slutar")}<input name="fy_end" type="date" defaultValue={`${year}-12-31`} required /></label>
        </div>
        <div className="row">
          <label>Momsredovisning
            <select name="vat_period" defaultValue="quarter">
              <option value="month">{L("Månad")}</option><option value="quarter">{L("Kvartal")}</option><option value="year">{L("År")}</option>
            </select>
          </label>
          <label>Redovisningsmetod
            <select name="accounting_method" defaultValue="invoice">
              <option value="invoice">{L("Faktureringsmetoden")}</option><option value="cash">{L("Kontantmetoden (bokslutsmetoden)")}</option>
            </select>
          </label>
        </div>
        <button>{L("Skapa bolag")}</button>
        <p className="small muted" style={{ margin: 0 }}>Allt står i registerutdraget från Skatteverket. Räkenskapsår: oftast kalenderår. Det första året börjar när verksamheten startar och
          får förlängas till högst 18 månader (t.ex. 31 oktober–31 december året efter). Momsredovisning: de flesta små företag redovisar per kvartal eller år.
          Kontantmetoden innebär att fakturor bokförs när de betalas. Allt kan ändras senare under Inställningar.</p>
      </form>
    </div>
  );
}
