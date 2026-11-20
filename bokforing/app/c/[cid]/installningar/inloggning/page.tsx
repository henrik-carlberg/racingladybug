import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { companyLoginLog, memberSessions, ssoConfig } from '@/lib/services/company-login';
import { deviceLabel } from '@/lib/sso';
import { requestOrigin } from '@/lib/server/origin';
import { block, ipList, removeSso, requireMfa, saveSso } from './actions';

export const dynamic = 'force-dynamic';
const METHOD: Record<string, string> = { password: 'Lösenord', totp: 'Lösenord + kod', passkey: 'Passkey', bankid: 'BankID', sso: 'SSO', register: 'Registrering', invite: 'Inbjudan' };

export default async function CompanyLogin({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { owner: true });
  const id = ctx.company.id;
  const sso = await ssoConfig(id);
  const sessions = await memberSessions(id);
  const log = await companyLoginLog(id);
  const origin = await requestOrigin();
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Inloggning och åtkomst</h1><Link className="btn secondary" href={`/c/${id}/installningar`}>Inställningar</Link></div>
      <Flash searchParams={searchParams} />

      <h2>Krav på tvåstegsverifiering</h2>
      <div className="card row">
        <span style={{ flex: '1 1 300px' }}>{ctx.company.require_mfa ? <b className="mfa-required">Krävs för alla i bolaget</b> : 'Krävs inte'} – gäller ägare, användare och redovisningsbyråns konsulter. Lösenord med engångskod, passkey, BankID och SSO med tvåstegsverifiering godkänns.</span>
        <form action={requireMfa.bind(null, id, !ctx.company.require_mfa)}><button className={ctx.company.require_mfa ? 'secondary' : ''}>{ctx.company.require_mfa ? 'Sluta kräva' : 'Kräv tvåstegsverifiering'}</button></form>
      </div>

      <h2>Företagsinloggning (SSO)</h2>
      <form action={saveSso.bind(null, id)} className="card stack">
        <div className="row">
          <label>Leverantör<select name="provider" defaultValue={sso?.provider ?? 'entra'}><option value="entra">Microsoft Entra ID</option><option value="google">Google Workspace</option><option value="oidc">Annan (OpenID Connect)</option></select></label>
          <label>Katalogens id (Entra)<input name="tenant" defaultValue={sso?.provider === 'entra' ? sso.issuer.split('/')[3] : ''} placeholder="00000000-0000-0000-0000-000000000000" /></label>
          <label style={{ flex: '2 1 260px' }}>Utfärdare (annan OIDC)<input name="issuer" defaultValue={sso?.provider === 'oidc' ? sso.issuer : ''} placeholder="https://idp.example.com" /></label>
        </div>
        <div className="row">
          <label>Klient-id<input name="client_id" defaultValue={sso?.client_id ?? ''} required /></label>
          <label>Klienthemlighet<input name="client_secret" type="password" placeholder={sso ? 'oförändrad' : ''} autoComplete="off" /></label>
          <label style={{ flex: '2 1 260px' }}>E-postdomäner<input name="domains" defaultValue={sso?.domains.join(', ') ?? ''} placeholder="exempel.se" required /></label>
        </div>
        <label className="check"><input type="checkbox" name="enforce" defaultChecked={sso?.enforce} /> Kräv SSO för alla med bolagets domäner (lösenord och andra sätt stängs av för dem i bolaget)</label>
        <label className="check"><input type="checkbox" name="idp_mfa" defaultChecked={sso?.idp_mfa} /> Leverantören kräver redan tvåstegsverifiering (räknas som tvåstegsverifiering här)</label>
        <p className="small muted" style={{ margin: 0 }}>Registrera appen hos leverantören med omdirigeringsadressen <code className="redirect-uri">{origin}/api/sso/callback</code> och behörigheterna openid, email och profile. Bara personer som redan är användare i bolaget kan logga in – bjud in dem först.</p>
        <div className="row"><button>{sso ? 'Spara' : 'Koppla företagsinloggning'}</button>{sso && <span className="sso-status">Kopplad: {sso.issuer}</span>}</div>
      </form>
      {sso && <form action={removeSso.bind(null, id)}><button className="secondary">Ta bort företagsinloggningen</button></form>}

      <h2>IP-begränsning</h2>
      <form action={ipList.bind(null, id)} className="card stack">
        <label>Tillåtna adresser och nät, en per rad (t.ex. 203.0.113.10 eller 198.51.100.0/24). Tomt = alla. Gäller inloggning i appen; API-nycklar och kopplade appar styrs med sina egna behörigheter.<textarea name="ip_allowlist" rows={3} defaultValue={ctx.company.ip_allowlist.join('\n')} /></label>
        <div><button className="secondary">Spara IP-begränsning</button></div>
      </form>

      <h2>Aktiva sessioner</h2>
      <div className="table-wrap"><table className="sessions">
        <thead><tr><th>Person</th><th>Enhet</th><th>Inloggning</th><th>Senast aktiv</th><th>IP</th><th></th></tr></thead>
        <tbody>{sessions.map((s) => (
          <tr key={s.ref} className="session"><td>{s.name}<div className="small muted">{s.email}</div></td><td>{s.device}</td><td>{METHOD[s.method] ?? s.method}{s.mfa ? ' ✓2' : ''}<div className="small muted">{s.created_at}</div></td><td>{s.last_seen_at}</td><td>{s.ip ?? ''}</td>
            <td>{s.current ? <span className="muted">Den här</span> : s.blocked ? <span className="muted">Utloggad</span> : <form action={block.bind(null, id, s.ref)}><button className="secondary">Logga ut</button></form>}</td></tr>
        ))}</tbody>
      </table></div>

      <h2>Inloggningslogg</h2>
      <div className="table-wrap"><table className="login-log">
        <thead><tr><th>Tid</th><th>Person</th><th>Sätt</th><th>Resultat</th><th>IP</th><th>Enhet</th></tr></thead>
        <tbody>{log.map((e, i) => (
          <tr key={i} className={`login-event ${e.success ? 'ok' : 'failed'}`}><td>{e.at}</td><td>{e.name ?? e.email}</td><td>{METHOD[e.method] ?? e.method}</td><td>{e.success ? 'Lyckad' : `Misslyckad${e.reason ? ` (${e.reason})` : ''}`}</td><td>{e.ip ?? ''}</td><td>{deviceLabel(e.user_agent)}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
