import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { Flash, type SP } from '@/components/ui';
import { today } from '@/lib/format';
import { listLog, listSites } from '@/lib/services/staff';
import { formatPnr } from '@/lib/rotrut';
import { addEntry, correct, createSite, rotateKiosk, stampFor } from './actions';

export const dynamic = 'force-dynamic';

export default async function StaffLog({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const d = typeof sp.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.datum) ? sp.datum : today();
  const [sites, open, entries, origin] = await Promise.all([listSites(company.id), listLog(company.id, { open: true }), listLog(company.id, { date: d }), requestOrigin()]);
  const active = sites.filter((s) => s.active);
  const qs = `?datum=${d}`;
  const b = `/c/${company.id}/personalliggare`;
  const t = (s: string | null) => (s ? s.replace('T', ' ') : '–');
  return (
    <div>
      <h1>Personalliggare</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">För verksamheter som måste föra personalliggare (t.ex. restaurang, frisör och skönhet, tvätteri, bilverkstad, livsmedels- och tobaksgrossister och byggarbetsplatser). Alla som arbetar – anställda, ägare och inhyrda – stämplar in när arbetspasset börjar och ut när det slutar.
        Rättelser sparas med ursprungligt värde och orsak. Liggaren ska kunna visas direkt vid Skatteverkets kontroll: använd <Link href={`${b}/kontroll`}>kontrollvyn</Link>. Uppgifterna sparas i två år efter utgången av kalenderåret.</p>

      <h2>Arbetsplatser</h2>
      {sites.map((s) => (
        <div key={s.id} className="card small">
          <b>{s.name}</b> {s.address && <span className="muted">{s.address}</span>}{s.kind === 'construction' && <span className="badge" style={{ marginLeft: '.4rem' }}>Byggarbetsplats {s.site_ref}</span>}
          <div>Stämplingssida (öppna på en surfplatta vid entrén): <code className="kiosk-url">{`${origin}/p/${s.kiosk_token}`}</code>
            <form action={rotateKiosk.bind(null, company.id, s.id)} style={{ display: 'inline', marginLeft: '.4rem' }}><button className="link">Ny adress</button></form></div>
        </div>
      ))}
      <form action={createSite.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
        <label>Arbetsplats<input name="name" required placeholder="T.ex. Salongen Storgatan" /></label>
        <label style={{ flex: '2 1 260px' }}>Adress<input name="address" /></label>
        <label className="check"><input type="checkbox" name="construction" /> Byggarbetsplats</label>
        <label>Byggarbetsplatsens ID (från Skatteverket)<input name="site_ref" placeholder="T.ex. BYGG12345678" /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg till arbetsplats</button></div>
      </form>

      {active.length > 0 && <>
        <h2>På plats nu ({open.length})</h2>
        <table className="small"><tbody>{open.map((e) => <tr key={e.id}><td>{e.person_name}</td><td className="mono">{formatPnr(e.personal_number)}</td><td>{e.site}</td><td>In {t(e.check_in)}</td></tr>)}
          {open.length === 0 && <tr><td className="muted">Ingen är instämplad.</td></tr>}</tbody></table>
        <form action={stampFor.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
          <label>Arbetsplats<select name="site_id">{active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Personnummer<input name="personal_number" required /></label>
          <label>Namn (om inte anställd)<input name="name" /></label>
          <label>ID06 (bygg)<input name="id06" /></label>
          <div style={{ flex: '0 0 auto' }}><button>Stämpla in/ut</button></div>
        </form>
      </>}

      <div className="header"><h2>Liggaren {d}</h2>
        <form className="row" style={{ alignItems: 'end' }}><label style={{ flex: '0 0 170px' }}>Datum<input type="date" name="datum" defaultValue={d} /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div></form></div>
      <div className="table-wrap"><table className="small">
        <thead><tr><th>Namn</th><th>Personnummer</th><th>ID06</th><th>Arbetsplats</th><th>In</th><th>Ut</th><th>Rättelser</th><th></th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.person_name}</td><td className="mono">{formatPnr(e.personal_number)}</td><td className="mono">{e.id06}</td><td>{e.site}{e.site_ref && <div className="muted">{e.site_ref}</div>}</td><td>{t(e.check_in)}</td><td>{t(e.check_out)}</td>
              <td>{e.changes.map((c, i) => <div key={i} className="muted">{c.at} {c.by}: {c.field} {c.old_value ? `${c.old_value.replace('T', ' ')} → ` : ''}{c.new_value.replace('T', ' ')} ({c.reason})</div>)}</td>
              <td><details><summary>Rätta</summary>
                <form action={correct.bind(null, company.id, e.id, qs)} className="stack" style={{ minWidth: 240 }}>
                  <label>In<input type="datetime-local" name="check_in" defaultValue={e.check_in} /></label>
                  <label>Ut<input type="datetime-local" name="check_out" defaultValue={e.check_out ?? ''} /></label>
                  <label>Orsak<input name="reason" required /></label>
                  <button className="secondary">Spara rättelse</button>
                </form></details></td>
            </tr>
          ))}
          {entries.length === 0 && <tr><td colSpan={8} className="muted">Inga registreringar detta datum.</td></tr>}
        </tbody>
      </table></div>

      {active.length > 0 && (
        <details className="card"><summary>Registrera i efterhand</summary>
          <form action={addEntry.bind(null, company.id)} className="row" style={{ alignItems: 'end', marginTop: '.5rem' }}>
            <label>Arbetsplats<select name="site_id">{active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>Personnummer<input name="personal_number" required /></label>
            <label>Namn (om inte anställd)<input name="name" /></label>
            <label>In<input type="datetime-local" name="check_in" required /></label>
            <label>Ut<input type="datetime-local" name="check_out" /></label>
            <label>Orsak<input name="reason" required placeholder="T.ex. glömde stämpla" /></label>
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg till</button></div>
          </form>
        </details>
      )}
    </div>
  );
}
