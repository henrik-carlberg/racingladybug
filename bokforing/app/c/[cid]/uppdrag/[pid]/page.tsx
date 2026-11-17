import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { Flash, Status, type SP } from '@/components/ui';
import { Help } from '@/components/Help';
import { kr, today } from '@/lib/format';
import { BILLING_LABEL, fmtHours, monthName, monthRange, previousMonth } from '@/lib/time';
import { getProject, listTimeEntries } from '@/lib/services/time';
import { bankStatement, buyHourBank, invoiceTime, saveActivity, updateProject } from '../actions';

export const dynamic = 'force-dynamic';

const krInput = (ore: number | null) => (ore == null ? '' : (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, ''));

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ cid: string; pid: string }>; searchParams: SP }) {
  const { cid, pid } = await params;
  const { company } = await requireCompany(cid);
  const p = await getProject(company.id, Number(pid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const b = `/c/${company.id}`;
  const t = today();
  const prev = previousMonth(t);
  const unbilled = await listTimeEntries(company.id, { project_id: p.id, unbilled: true });
  const months = await sql<{ period: string; minutes: number; billable: number }[]>`
    SELECT to_char(date,'YYYY-MM') AS period, SUM(minutes)::int AS minutes, (SUM(minutes) FILTER (WHERE billable))::int AS billable
    FROM time_entries WHERE project_id = ${p.id} GROUP BY 1 ORDER BY 1 DESC LIMIT 12`;
  const invoices = await sql<{ id: number; invoice_number: number | null; invoice_date: string; status: string; total: number; hour_bank: { period: string; used_now: number; remaining: number; overage: number } | null; purchase: number | null }[]>`
    SELECT i.id, i.invoice_number, to_char(i.invoice_date,'YYYY-MM-DD') AS invoice_date, i.status, i.total, i.hour_bank,
      (SELECT minutes FROM hour_bank_purchases h WHERE h.invoice_id = i.id) AS purchase
    FROM invoices i WHERE i.project_id = ${p.id} AND i.company_id = ${company.id} ORDER BY i.invoice_date DESC, i.id DESC`;
  const bank = p.bank;

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header">
        <h1>{p.name} <span className="muted" style={{ fontWeight: 400 }}>· {p.customer_name}</span></h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`${b}/uppdrag`}>Alla uppdrag</Link>
          <Link className="btn" href={`${b}/tid`}>⏱ Rapportera tid</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />

      <div className="grid">
        <div className="card stat"><div className="label">Fakturering</div><div className="value" style={{ fontSize: '1.1rem' }}>{BILLING_LABEL[p.billing]}</div></div>
        <div className="card stat"><div className="label">Totalt rapporterat</div><div className="value">{fmtHours(p.minutes_total)}</div></div>
        {bank ? (
          <div className="card stat"><div className="label">Kvar i timbanken <Help term="timbank" /></div>
            <div className="value" style={bank.remaining < 0 ? { color: 'var(--danger)' } : undefined}>{fmtHours(bank.remaining)}</div>
            <div className="small muted">Köpt {fmtHours(bank.purchased)} · avräknat {fmtHours(bank.drawn)} · ej avräknat {fmtHours(bank.unreported)}</div></div>
        ) : (p.billing === 'hourly' && (
          <div className="card stat"><div className="label">Ofakturerat</div><div className="value">{fmtHours(p.minutes_unbilled)}</div><div className="small muted">{kr(p.value_unbilled)} kr exkl. moms</div></div>
        ))}
      </div>

      {p.billing === 'hourly' && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Fakturera arbetad tid</h2>
          <p className="small">Ofakturerad debiterbar tid blir ett fakturautkast med en rad per aktivitet och en tidsspecifikation. Fakturerad tid låses.</p>
          <form action={invoiceTime.bind(null, company.id, p.id)} className="row">
            <label>Från (valfritt)<input type="date" name="from" /></label>
            <label>Till och med<input type="date" name="to" defaultValue={monthRange(prev)[1] < t ? monthRange(prev)[1] : t} required /></label>
            <label>Fakturadatum<input type="date" name="invoice_date" defaultValue={t} /></label>
            <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button disabled={!unbilled.length}>Skapa fakturaunderlag</button></div>
          </form>
        </div>
      )}

      {p.billing === 'hour_bank' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <form action={bankStatement.bind(null, company.id, p.id)} className="card stack">
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Månadsavräkning</h2>
            <p className="small" style={{ margin: 0 }}>En faktura som visar använda timmar under månaden och hur många som finns kvar. Timmar utöver banken faktureras med timpriset.
              Avräkningar skapas också automatiskt som utkast den 1:a varje månad.</p>
            <label>Månad<input type="month" name="period" defaultValue={prev} required /></label>
            <div><button>Skapa avräkning</button></div>
          </form>
          <form action={buyHourBank.bind(null, company.id, p.id)} className="card stack">
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Kunden köper timmar</h2>
            <p className="small" style={{ margin: 0 }}>Skapar en faktura för timmarna. De räknas in i banken när fakturan bokförs.</p>
            <div className="row">
              <label>Antal timmar<input name="hours" inputMode="decimal" required placeholder="40" /></label>
              <label>Timpris (kr)<input name="hourly_rate" inputMode="decimal" defaultValue={krInput(p.hourly_rate)} /></label>
            </div>
            <label>Fakturadatum<input type="date" name="date" defaultValue={t} /></label>
            <div><button className="secondary">Skapa faktura för timbank</button></div>
          </form>
        </div>
      )}

      {invoices.length > 0 && (<>
        <h2>Fakturor och avräkningar</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Datum</th><th>Faktura</th><th>Avser</th><th>Status</th><th className="num">Belopp</th></tr></thead>
          <tbody>{invoices.map((i) => (
            <tr key={i.id}>
              <td>{i.invoice_date}</td>
              <td><Link href={`${b}/fakturor/${i.id}`}>{i.invoice_number ?? 'Utkast'}</Link></td>
              <td className="small">{i.hour_bank ? `Avräkning ${monthName(i.hour_bank.period)}: ${fmtHours(i.hour_bank.used_now)} använda, ${fmtHours(i.hour_bank.remaining)} kvar${i.hour_bank.overage ? `, ${fmtHours(i.hour_bank.overage)} övertid` : ''}`
                : i.purchase ? `Köp av timbank ${fmtHours(i.purchase)}` : 'Arbetad tid'}</td>
              <td><Status s={i.status} /></td>
              <td className="num">{kr(i.total)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </>)}

      <h2>Aktiviteter</h2>
      <p className="small muted">Tomt timpris = uppdragets timpris ({kr(p.hourly_rate)} kr). Ej debiterbara aktiviteter följs upp men faktureras inte.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Aktivitet</th><th>Timpris (kr)</th><th>Debiterbar</th><th>Aktiv</th><th></th></tr></thead>
        <tbody>
          {p.activities.map((a) => (
            <tr key={a.id}>
              <td colSpan={5}>
                <form action={saveActivity.bind(null, company.id, p.id, a.id)} className="row" style={{ alignItems: 'center' }}>
                  <input name="name" defaultValue={a.name} aria-label="Aktivitet" style={{ flex: 2 }} />
                  <input name="hourly_rate" defaultValue={krInput(a.hourly_rate)} placeholder={krInput(p.hourly_rate)} aria-label="Timpris" inputMode="decimal" />
                  <label className="check"><input type="checkbox" name="billable" defaultChecked={a.billable} /> Debiterbar</label>
                  <label className="check"><input type="checkbox" name="active" defaultChecked={a.active} /> Aktiv</label>
                  <button className="link">Spara</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <form action={saveActivity.bind(null, company.id, p.id, null)} className="card row" style={{ marginTop: '.5rem' }}>
        <label style={{ flex: 2 }}>Ny aktivitet<input name="name" required placeholder="T.ex. Projektledning" /></label>
        <label>Timpris (kr)<input name="hourly_rate" inputMode="decimal" placeholder={krInput(p.hourly_rate)} /></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="billable" defaultChecked /> Debiterbar</label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till</button></div>
      </form>

      {unbilled.length > 0 && (<>
        <h2>{p.billing === 'hour_bank' ? 'Ej avräknad tid' : 'Ofakturerad tid'}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Datum</th><th>Aktivitet</th><th>Beskrivning</th><th>Person</th><th className="num">Tid</th></tr></thead>
          <tbody>{unbilled.map((e) => (
            <tr key={e.id}><td>{e.date}</td><td>{e.activity_name}</td><td className="small">{e.description}</td><td className="small">{e.user_name}</td><td className="num">{fmtHours(e.minutes)}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}

      {months.length > 0 && (<>
        <h2>Tid per månad</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Månad</th><th className="num">Totalt</th><th className="num">Debiterbart</th></tr></thead>
          <tbody>{months.map((m) => (
            <tr key={m.period}><td>{monthName(m.period)}</td><td className="num">{fmtHours(m.minutes)}</td><td className="num">{fmtHours(m.billable ?? 0)}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}

      <h2>Inställningar för uppdraget</h2>
      <form action={updateProject.bind(null, company.id, p.id)} className="card stack">
        <div className="row">
          <label style={{ flex: 2 }}>Namn<input name="name" defaultValue={p.name} required /></label>
          <label>Fakturering
            <select name="billing" defaultValue={p.billing}>
              {Object.entries(BILLING_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Timpris exkl. moms (kr)<input name="hourly_rate" defaultValue={krInput(p.hourly_rate)} inputMode="decimal" /></label>
        </div>
        <label>Anteckningar<textarea name="notes" rows={2} defaultValue={p.notes} /></label>
        <label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> Pågående (avmarkera när uppdraget är avslutat)</label>
        <div><button>Spara</button></div>
      </form>
    </div>
  );
}
