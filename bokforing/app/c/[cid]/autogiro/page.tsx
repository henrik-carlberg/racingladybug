import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, EmptyState, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { drawable, listDraws, listFiles, listMandates } from '@/lib/services/autogiro';
import { addMandate, drawFile, importResult, mandateFile, setStatus, settings } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, [string, string]> = { new: ['Ny', 'warn'], sent: ['Skickad till Bankgirot', 'warn'], active: ['Aktiv', 'ok'], cancelled: ['Makulerad', ''], scheduled: ['Väntar', 'warn'], paid: ['Betald', 'ok'], failed: ['Misslyckades', 'danger'] };

export default async function Autogiro({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const b = `/c/${company.id}/autogiro`;
  const sp = await searchParams;
  const [{ customer_no }] = await sql<{ customer_no: string }[]>`SELECT autogiro_customer_no AS customer_no FROM companies WHERE id = ${company.id}`;
  const [mandates, draws, files, todo, customers] = await Promise.all([listMandates(company.id), listDraws(company.id), listFiles(company.id), drawable(company.id),
    sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${company.id} ORDER BY name`]);
  const badge = (s: string) => <span className={`badge ${ST[s]?.[1] ?? ''}`}>{ST[s]?.[0] ?? s}</span>;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Autogiro</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Dra betalningen direkt från kundens konto på förfallodagen. Kunden lämnar ett medgivande en gång, sedan skapar du en dragningsfil för fakturorna och läser in Bankgirots återrapport – betalningarna bokförs automatiskt.</p>
      {sp.fil && <div className="flash ok"><a href={`${b}/fil/${sp.fil}`} download>Ladda ner filen</a> och ladda upp den i Bankgirots tjänst (via banken).</div>}

      <form action={settings.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
        <label>Kundnummer för Autogiro (från Bankgirot)<input name="customer_no" defaultValue={customer_no} placeholder="123456" inputMode="numeric" /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Spara</button></div>
        <span className="small muted">Bankgironumret hämtas från Inställningar. Avtal om Autogiro tecknas med banken.</span>
      </form>

      <h2>1. Medgivanden</h2>
      {mandates.length === 0 ? <EmptyState icon="users" title="Inga medgivanden än">Registrera kundens medgivande med clearing- och kontonummer. Medgivandet skickas till Bankgirot som en fil och blir aktivt när banken har godkänt det.</EmptyState> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Kund</th><th>Betalarnummer</th><th>Konto</th><th>Status</th><th></th></tr></thead>
          <tbody>{mandates.map((m) => (
            <tr key={m.id}><td>{m.customer}</td><td>{m.payer_number}</td><td>{m.clearing}-{m.account.replace(/\d(?=\d{4})/g, '•')}</td><td>{badge(m.status)}</td>
              <td className="num">{m.status === 'sent' && <form action={setStatus.bind(null, company.id, m.id, 'active')} style={{ display: 'inline' }}><button className="link small">Godkänt av banken</button></form>}
                {m.status !== 'cancelled' && <form action={setStatus.bind(null, company.id, m.id, 'cancelled')} style={{ display: 'inline', marginLeft: 8 }}><button className="link small">Makulera</button></form>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <form action={addMandate.bind(null, company.id)} className="card stack" style={{ flex: '2 1 420px' }}>
          <b>Nytt medgivande</b>
          <div className="row">
            <label>Kund<select name="customer_id" required><option value="">Välj…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Personnummer eller org.nr<input name="id_number" required /></label>
          </div>
          <div className="row">
            <label style={{ flex: '0 0 120px' }}>Clearingnummer<input name="clearing" required inputMode="numeric" /></label>
            <label>Kontonummer<input name="account" required inputMode="numeric" /></label>
            <label>Betalarnummer (valfritt)<input name="payer_number" inputMode="numeric" placeholder="Kundnumret" /></label>
          </div>
          <div><button className="secondary">Registrera medgivande</button></div>
        </form>
        <form action={mandateFile.bind(null, company.id)} className="card stack" style={{ flex: '1 1 240px' }}>
          <b>Skicka till Bankgirot</b>
          <span className="small muted">{mandates.filter((m) => m.status === 'new').length} nya medgivanden väntar.</span>
          <div><button disabled={!mandates.some((m) => m.status === 'new')}>Skapa medgivandefil</button></div>
        </form>
      </div>

      <h2>2. Dragningar</h2>
      {todo.length === 0 ? <p className="small muted">Inga obetalda fakturor till kunder med aktivt medgivande.</p> : (
        <form action={drawFile.bind(null, company.id)} className="stack">
          <div className="table-wrap"><table>
            <thead><tr><th></th><th>Faktura</th><th>Kund</th><th>Förfaller</th><th className="num">Belopp</th></tr></thead>
            <tbody>{todo.map((x) => <tr key={x.id}><td><input type="checkbox" name="invoice" value={x.id} defaultChecked aria-label={`Dra faktura ${x.number}`} /></td><td><Link href={`/c/${company.id}/fakturor/${x.id}`}>{x.number}</Link></td><td>{x.customer}</td><td>{x.due}</td><td className="num">{kr(x.remaining)}</td></tr>)}</tbody>
          </table></div>
          <div><button>Skapa dragningsfil</button> <span className="small muted">Dras på förfallodagen, tidigast nästa bankdag.</span></div>
        </form>
      )}

      <h2>3. Återrapport från Bankgirot</h2>
      <form action={importResult.bind(null, company.id)} className="card row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '3 1 300px' }}>Återrapport (fil från Bankgirot)<input type="file" name="file" required /></label>
        <div style={{ flex: '0 0 auto' }}><button>Läs in och bokför</button></div>
      </form>
      {draws.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Faktura</th><th>Kund</th><th>Dragningsdag</th><th className="num">Belopp</th><th>Status</th></tr></thead>
          <tbody>{draws.map((d) => <tr key={d.id}><td><Link href={`/c/${company.id}/fakturor/${d.invoice_id}`}>{d.number}</Link></td><td>{d.customer}</td><td>{d.date}</td><td className="num">{kr(d.amount)}</td><td>{badge(d.status)} {d.status === 'failed' && <span className="small">{d.message}</span>}</td></tr>)}</tbody>
        </table></div>
      )}
      {files.length > 0 && <details className="card"><summary>Skapade filer ({files.length})</summary><ul className="small">{files.map((f) => <li key={f.id}><a href={`${b}/fil/${f.id}`} download>{f.kind === 'draws' ? 'Dragningar' : 'Medgivanden'} {f.created_at}</a> ({f.lines} poster)</li>)}</ul></details>}
    </div>
  );
}
