import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { Help } from '@/components/Help';
import { kr, today } from '@/lib/format';
import { BILLING_LABEL, fmtHours, monthName, previousMonth } from '@/lib/time';
import { listProjects, pendingBankStatements } from '@/lib/services/time';
import { allBankStatements, createProject } from './actions';

export const dynamic = 'force-dynamic';

export default async function Projects({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const projects = await listProjects(company.id);
  const customers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM customers WHERE company_id = ${company.id} ORDER BY name`;
  const period = previousMonth(today());
  const pending = await pendingBankStatements(company.id, period);
  const b = `/c/${company.id}`;

  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header">
        <h1>Uppdrag <Help term="uppdrag" /></h1>
        <div className="actions" style={{ margin: 0 }}><Link className="btn" href={`${b}/tid`}>⏱ Rapportera tid</Link></div>
      </div>
      <Flash searchParams={searchParams} />

      {pending.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warn, #d97706)' }}>
          <b>Timbanksavräkning för {monthName(period)}</b>
          <p className="small">{pending.length} timbanker saknar avräkning: {pending.map((p) => `${p.customer_name} – ${p.name}`).join(', ')}.
            Avräkningen är en faktura som visar använda timmar och hur många som finns kvar. Timmar utöver banken faktureras.</p>
          <form action={allBankStatements.bind(null, company.id, period)}><button>Skapa avräkningar för {monthName(period)}</button></form>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Kund</th><th>Uppdrag</th><th>Fakturering</th><th className="num">Timpris</th><th className="num">Ofakturerat</th><th className="num">Timbank kvar</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} style={p.active ? undefined : { opacity: 0.55 }}>
                <td>{p.customer_name}</td>
                <td><Link href={`${b}/uppdrag/${p.id}`}>{p.name}</Link>{!p.active && <span className="badge" style={{ marginLeft: '.3rem' }}>Avslutat</span>}</td>
                <td>{BILLING_LABEL[p.billing]}</td>
                <td className="num">{p.hourly_rate ? kr(p.hourly_rate) : ''}</td>
                <td className="num">{p.minutes_unbilled && (p.billing === 'hourly' || p.billing === 'hour_bank') ? <>{fmtHours(p.minutes_unbilled)}{p.billing === 'hourly' && <span className="small muted"> · {kr(p.value_unbilled)} kr</span>}</> : ''}</td>
                <td className="num">{p.bank ? <span style={p.bank.remaining < 0 ? { color: 'var(--danger)' } : undefined}>{fmtHours(p.bank.remaining)}</span> : ''}</td>
              </tr>
            ))}
            {projects.length === 0 && <tr><td colSpan={6} className="muted">Inga uppdrag ännu.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Nytt uppdrag</h2>
      {customers.length === 0 ? (
        <p>Lägg först upp en <Link href={`${b}/kunder`}>kund</Link>.</p>
      ) : (
        <form action={createProject.bind(null, company.id)} className="card stack">
          <div className="row">
            <label>Kund<select name="customer_id" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label style={{ flex: 2 }}>Namn på uppdraget<input name="name" required placeholder="T.ex. Utveckling av webbshop" /></label>
          </div>
          <div className="row">
            <label>Fakturering
              <select name="billing" defaultValue="hourly">
                <option value="hourly">Löpande räkning – faktura på arbetad tid</option>
                <option value="hour_bank">Timbank – kunden köper timmar i förväg</option>
                <option value="fixed">Fast pris – tiden följs upp men faktureras inte</option>
                <option value="internal">Internt – faktureras inte</option>
              </select>
            </label>
            <label>Timpris exkl. moms (kr)<input name="hourly_rate" inputMode="decimal" placeholder="950" /></label>
            <label>Moms<select name="vat_rate" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
          </div>
          <label>Aktiviteter (en per rad – kan få egna timpriser senare)
            <textarea name="activities" rows={3} defaultValue={'Konsulttid'} />
          </label>
          <div><button>Skapa uppdrag</button></div>
        </form>
      )}
    </div>
  );
}
