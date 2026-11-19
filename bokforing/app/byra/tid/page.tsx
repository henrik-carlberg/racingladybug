import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { myFirms } from '@/lib/services/firms';
import { timeSummary } from '@/lib/services/firm-close';
import { addFirmTime, invoiceFirmTime, saveBilling } from '../actions';

export const dynamic = 'force-dynamic';
const h = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/** Byråns tid per klient och månad, och fakturaunderlag till byråns eget bolag */
export default async function FirmTime({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const firms = await myFirms(user.id);
  const firm = firms.find((f) => String(f.id) === sp.f) ?? firms[0];
  if (!firm) return <div className="center"><p><Link href="/byra">Skapa en byrå</Link></p></div>;
  const period = /^\d{4}-\d{2}$/.test(String(sp.period)) ? String(sp.period) : today().slice(0, 7);
  const rows = await timeSummary(user.id, firm.id, period);
  const [f] = await sql<{ own: number | null }[]>`SELECT own_company_id AS own FROM firms WHERE id = ${firm.id}`;
  const mine = await sql<{ id: number; name: string }[]>`SELECT c.id, c.name FROM companies c JOIN memberships m ON m.company_id = c.id WHERE m.user_id = ${user.id} AND m.role = 'owner' ORDER BY c.name`;
  const recent = await sql<{ date: string; client: string; minutes: number; description: string; who: string | null; billed: boolean }[]>`
    SELECT to_char(t.date,'YYYY-MM-DD') AS date, c.name AS client, t.minutes, t.description, u.name AS who, t.invoice_id IS NOT NULL AS billed
    FROM firm_time t JOIN companies c ON c.id = t.company_id LEFT JOIN users u ON u.id = t.user_id WHERE t.firm_id = ${firm.id} AND to_char(t.date,'YYYY-MM') = ${period} ORDER BY t.date DESC, t.id DESC LIMIT 100`;
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 16px' }}>
      <div className="header"><h1>Byråns tid {period}</h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={`/byra/manad?f=${firm.id}`}>Månadsbokslut</Link><Link className="btn secondary" href={`/byra?f=${firm.id}`}>Klienter</Link></div></div>
      <Flash searchParams={searchParams} />
      <form action={addFirmTime.bind(null, firm.id, period)} className="card row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '2 1 200px' }}>Klient<select name="company_id" required><option value="">Välj…</option>{rows.map((r) => <option key={r.company_id} value={r.company_id}>{r.name}</option>)}</select></label>
        <label style={{ flex: '0 0 150px' }}>Datum<input type="date" name="date" defaultValue={today()} required /></label>
        <label style={{ flex: '0 0 110px' }}>Tid (t:mm)<input name="time" placeholder="1:30" required /></label>
        <label style={{ flex: '2 1 220px' }}>Vad<input name="description" placeholder="T.ex. Bankavstämning och moms" /></label>
        <div style={{ flex: '0 0 auto' }}><button>Registrera</button></div>
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Klient</th><th className="num">Tid</th><th className="num">Ofakturerat</th><th className="num">Timpris</th><th className="num">Att fakturera</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.company_id}><td>{r.name}</td><td className="num">{h(r.minutes)}</td><td className="num">{h(r.unbilled)}</td><td className="num">{r.rate ? kr(r.rate) : '–'}</td>
            <td className="num">{r.rate && r.unbilled ? kr(Math.round((r.unbilled / 60) * r.rate)) : '–'}</td>
            <td className="num">{r.unbilled > 0 && <form action={invoiceFirmTime.bind(null, firm.id, r.company_id, period)}><button className="link small" disabled={!f.own || !r.rate}>Skapa fakturautkast</button></form>}</td></tr>
        ))}</tbody>
      </table></div>
      {recent.length > 0 && <details className="card"><summary>Registrerad tid ({recent.length})</summary><table className="small"><tbody>{recent.map((t, i) => <tr key={i}><td>{t.date}</td><td>{t.client}</td><td className="num">{h(t.minutes)}</td><td>{t.description}</td><td>{t.who}</td><td>{t.billed ? <span className="badge ok">Fakturerad</span> : ''}</td></tr>)}</tbody></table></details>}
      {firm.role === 'owner' && (
        <form action={saveBilling.bind(null, firm.id, period)} className="card stack">
          <b>Fakturering</b>
          <label>Byråns eget bolag (fakturorna skapas där)<select name="own_company_id" defaultValue={f.own ?? ''}><option value="">Välj…</option>{mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="row">{rows.map((r) => <label key={r.company_id} style={{ flex: '0 1 220px' }}>Timpris {r.name} (kr exkl. moms)<input name={`rate_${r.company_id}`} defaultValue={r.rate ? String(r.rate / 100) : ''} inputMode="decimal" /></label>)}</div>
          <div><button className="secondary">Spara</button></div>
        </form>
      )}
    </div>
  );
}
