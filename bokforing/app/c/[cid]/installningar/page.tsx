import { headers } from 'next/headers';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { fiscalYears } from '@/lib/server/ledger';
import { Flash, type SP } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/format';
import * as a from './actions';
import { Help } from '@/components/Help';

export const dynamic = 'force-dynamic';

export default async function Settings({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company: c, role, user } = await requireCompany(cid);
  const sp = await searchParams;
  const years = await fiscalYears(c.id);
  const members = await sql<{ id: number; name: string; email: string; role: 'owner' | 'accountant' }[]>`
    SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${c.id} ORDER BY m.role DESC, u.name`;
  const invites = await sql<{ id: number; email: string; role: 'owner' | 'accountant'; expires: string }[]>`
    SELECT id, email, role, to_char(expires_at,'YYYY-MM-DD') AS expires FROM invites
    WHERE company_id = ${c.id} AND accepted_at IS NULL AND expires_at > now() ORDER BY id DESC`;
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;
  const isOwner = role === 'owner';
  return (
    <>
      <h1>Inställningar</h1>
      <Flash searchParams={searchParams} />
      {sp.invite && (
        <div className="flash ok">
          Inbjudan är skapad. Skicka länken till personen (gäller i 7 dagar):<br />
          <code className="mono" style={{ wordBreak: 'break-all' }}>{origin}/invite/{String(sp.invite)}</code>
        </div>
      )}

      <h2>Företagsuppgifter</h2>
      <form action={a.updateCompany.bind(null, c.id)} className="card stack">
        <div className="row">
          <label>Företagsnamn<input name="name" defaultValue={c.name} required /></label>
          <label>Org.nr<input value={c.orgnr} disabled /></label>
          <label>Bolagsform<input value={c.company_type === 'AB' ? 'Aktiebolag' : 'Enskild firma'} disabled /></label>
        </div>
        <div className="row">
          <label>Adress<input name="address" defaultValue={c.address} /></label>
          <label>Postnummer<input name="postal_code" defaultValue={c.postal_code} /></label>
          <label>Ort<input name="city" defaultValue={c.city} /></label>
        </div>
        <div className="row">
          <label>E-post<input name="email" type="email" defaultValue={c.email} /></label>
          <label>Telefon<input name="phone" defaultValue={c.phone} /></label>
          <label>Momsreg.nr<input name="vat_number" defaultValue={c.vat_number} placeholder="SE556677889901" /></label>
        </div>
        <div className="row">
          <label>Bankgiro<input name="bankgiro" defaultValue={c.bankgiro} /></label>
          <label>Plusgiro<input name="plusgiro" defaultValue={c.plusgiro} /></label>
          <label>IBAN<input name="iban" defaultValue={c.iban} /></label>
        </div>
        <div className="row">
          <label>Betalningsvillkor (dagar)<input name="invoice_terms" type="number" min={0} defaultValue={c.invoice_terms} /></label>
          <label>Momsredovisning
            <select name="vat_period" defaultValue={c.vat_period}>
              <option value="month">Månad</option><option value="quarter">Kvartal</option><option value="year">År</option>
            </select>
          </label>
          <label>Text om dröjsmålsränta<input name="late_interest" defaultValue={c.late_interest} /></label>
        </div>
        <label className="check"><input type="checkbox" name="f_skatt" defaultChecked={c.f_skatt} /> Godkänd för F-skatt</label>
        <div><button>Spara</button></div>
      </form>

      <h2>Räkenskapsår</h2>
      <table>
        <thead><tr><th>Från</th><th>Till</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.id}>
              <td>{y.start_date}</td><td>{y.end_date}</td>
              <td>{y.closed ? <span className="badge">Stängt</span> : <span className="badge ok">Öppet</span>}</td>
              <td className="num">
                <form action={a.setFiscalYearClosed.bind(null, c.id, y.id, !y.closed)}>
                  <button className="link">{y.closed ? 'Öppna' : 'Stäng'}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form action={a.addFiscalYear.bind(null, c.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Nytt räkenskapsår från<input name="start" type="date" required /></label>
        <label>till<input name="end" type="date" required /></label>
        <div style={{ flex: '0 0 auto' }}><button>Lägg till</button></div>
      </form>

      <h2>Periodlås <Help term="periodlas" /></h2>
      <p className="muted small">Inga verifikationer kan bokföras på eller före låsdatumet. Lås perioden när momsen är redovisad.</p>
      <form action={a.setLock.bind(null, c.id)} className="card row">
        <label>Låst till och med<input name="locked_until" type="date" defaultValue={c.locked_until ?? ''} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Spara</button></div>
      </form>

      <h2>Användare</h2>
      <table>
        <thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th></th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td><td>{m.email}</td><td>{ROLE_LABEL[m.role]}</td>
              <td className="num">{isOwner && m.id !== user.id && (
                <form action={a.removeMember.bind(null, c.id, m.id)}><button className="link">Ta bort</button></form>
              )}</td>
            </tr>
          ))}
          {invites.map((i) => (
            <tr key={`i${i.id}`}>
              <td className="muted">Inbjuden</td><td>{i.email}</td><td>{ROLE_LABEL[i.role]} <span className="muted small">(t.o.m. {i.expires})</span></td>
              <td className="num">{isOwner && <form action={a.revokeInvite.bind(null, c.id, i.id)}><button className="link">Återkalla</button></form>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isOwner ? (
        <form action={a.invite.bind(null, c.id)} className="card row" style={{ marginTop: '1rem' }}>
          <label>Bjud in e-post<input name="email" type="email" required /></label>
          <label>Roll
            <select name="role"><option value="accountant">Redovisningskonsult</option><option value="owner">Ägare</option></select>
          </label>
          <div style={{ flex: '0 0 auto' }}><button>Skapa inbjudan</button></div>
        </form>
      ) : <p className="muted small">Endast ägare kan bjuda in och ta bort användare.</p>}
      <p className="muted small">En redovisningskonsult kan bokföra, fakturera, attestera och betala leverantörsfakturor samt köra lön, men inte hantera användare.</p>
    </>
  );
}
