import { translator } from '@/lib/ui-i18n';
import { uiLang } from '@/lib/server/lang';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { kr, today } from '@/lib/format';
import { Flash, type SP } from '@/components/ui';
import { getSetup } from '@/lib/services/setup';
import { companyDeadlines } from '@/lib/services/deadlines';
import { companyTodos } from '@/lib/services/todo';
import { enabledModules } from '@/lib/modules/enabled';
import { Icon } from '@/components/Icon';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid);
  const { company } = ctx;
  const L = translator(await uiLang());
  const id = company.id;
  const setup = await getSetup(id, ctx.user.id);
  const upcoming = (await companyDeadlines(id)).filter((d) => d.status !== 'done').slice(0, 3);
  const todos = await companyTodos(id, { modules: (await enabledModules(id)).map((m) => m.id), owner: ctx.role === 'owner', userId: ctx.user.id });
  const t = today();
  const [bank] = await sql<{ v: number }[]>`
    SELECT COALESCE(SUM(l.debit - l.credit), 0)::bigint AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${id} AND l.account_number BETWEEN 1910 AND 1949`;
  const [ar] = await sql<{ n: number; v: number; overdue: number }[]>`
    SELECT count(*)::int AS n, COALESCE(SUM(total - paid_amount), 0)::bigint AS v,
           COALESCE(SUM(total - paid_amount) FILTER (WHERE due_date < ${t}), 0)::bigint AS overdue
    FROM invoices WHERE company_id = ${id} AND status = 'booked'`;
  const [ap] = await sql<{ n: number; v: number; unapproved: number }[]>`
    SELECT count(*)::int AS n, COALESCE(SUM(total - paid_amount), 0)::bigint AS v, count(*) FILTER (WHERE status = 'booked')::int AS unapproved
    FROM supplier_invoices WHERE company_id = ${id} AND status IN ('booked','approved')`;
  const [res] = await sql<{ v: number }[]>`
    SELECT COALESCE(SUM(l.credit - l.debit), 0)::bigint AS v FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    JOIN fiscal_years f ON f.id = v.fiscal_year_id
    WHERE v.company_id = ${id} AND l.account_number >= 3000 AND l.account_number < 8999 AND ${t}::date BETWEEN f.start_date AND f.end_date`;
  const recent = await sql<{ id: number; series: string; number: number; date: string; description: string }[]>`
    SELECT id, series, number, to_char(date,'YYYY-MM-DD') AS date, description FROM vouchers
    WHERE company_id = ${id} ORDER BY created_at DESC LIMIT 8`;
  const b = `/c/${id}`;
  const hour = Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: 'numeric' }).format(new Date()));
  const hi = hour < 10 ? L('God morgon') : hour < 18 ? L('Hej') : L('God kväll');
  const first = ctx.user.name.split(' ')[0];
  const urgentTodos = todos.filter((x) => x.level !== 'info');
  const tiles: [string, string, string, string][] = [
    ['receipt', L('Kvitto eller utlägg'), L('Fota kvittot – appen läser av och bokför'), `${b}/kvitto`],
    ['invoice', L('Skicka faktura'), L('Fakturera en kund på en minut'), `${b}/fakturor/ny`],
    ['inbox', L('Leverantörsfaktura'), L('Registrera, attestera och betala'), `${b}/leverantorsfakturor/ny`],
    ['bank', L('Stäm av banken'), L('Bokför det som hänt på kontot'), `${b}/bank/avstamning`],
    ['clock', L('Rapportera tid'), L('Per uppdrag och aktivitet'), `${b}/tid`],
    ['wallet', L('Kör lön'), L('Lönespecar, utbetalning och AGI'), `${b}/lon`],
    ['calendar', L('Deadlines'), L('Moms, AGI och bokslut'), `${b}/deadlines`],
    ['sparkles', L('Fråga assistenten'), L('”Hur gick förra månaden?”'), `${b}/assistent`],
  ];
  return (
    <>
      <div className="hello">
        <h1>{hi}, {first}!</h1>
        <div className="muted">{company.name} · {urgentTodos.length ? `${urgentTodos.reduce((n, x) => n + x.count, 0)} ${L('saker väntar på dig')}` : L('Inget brådskande just nu')}</div>
      </div>
      <Flash searchParams={searchParams} />
      {!setup.complete && (
        <div className="card" style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}>
          <div className="header" style={{ margin: 0 }}>
            <div><b>{L("Kom igång")}</b> – {setup.done} av {setup.total} steg klara. Nästa: {setup.steps.find((x) => !x.done && !x.skipped)?.title}</div>
            <Link className="btn" href={`/c/${id}/kom-igang`}>{L("Fortsätt")}</Link>
          </div>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{L("Att göra")}</h2>
          {todos.length ? (
            <div className="todo-list">
              {todos.map((x) => (
                <Link key={x.key} href={x.href} className={`todo ${x.level}`}>
                  <span className="dot" aria-hidden="true" />
                  <span><span className="count">{x.count}</span> {L(x.title)}</span>
                  <span className="go">{L("Öppna")} <Icon name="arrow" size={14} /></span>
                </Link>
              ))}
            </div>
          ) : <div className="all-done"><Icon name="check" /> {L('Allt är klart – inget väntar på dig.')}</div>}
        </section>
        <section className="card">
          <div className="header" style={{ marginBottom: '.5rem' }}><h2 style={{ margin: 0 }}>{L("Nästa deadlines")}</h2><Link href={`/c/${id}/deadlines`} className="small">{L("Visa alla")}</Link></div>
          {upcoming.length ? (
            <div className="todo-list">
              {upcoming.map((d) => (
                <Link key={d.key} href={d.href} className={`todo ${d.status === 'overdue' ? 'danger' : ''}`}>
                  <span className="dot" aria-hidden="true" />
                  <span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{d.due}</b> {d.title} {d.status === 'overdue' && <span className="badge danger">{L("Försenad")}</span>}</span>
                  <span className="go"><Icon name="arrow" size={14} /></span>
                </Link>
              ))}
            </div>
          ) : <div className="all-done"><Icon name="check" /> {L('Inga deadlines de närmaste veckorna.')}</div>}
        </section>
      </div>

      <h2>{L("Vad vill du göra?")}</h2>
      <div className="tiles">
        {tiles.map(([icon, title, sub, href]) => (
          <Link key={href} href={href} className="tile">
            <span className="tile-icon"><Icon name={icon} size={20} /></span>
            <span><b>{title}</b><span>{sub}</span></span>
          </Link>
        ))}
      </div>

      <h2>{L('Läget just nu')}</h2>
      <div className="grid">
        <div className="card stat"><div className="label">{L("Bank och kassa")}</div><div className="value">{kr(bank.v)}</div></div>
        <div className="card stat"><div className="label">{L("Resultat i år")}</div><div className="value" style={res.v < 0 ? { color: 'var(--danger)' } : undefined}>{kr(res.v)}</div></div>
        <Link className="card stat" href={`${b}/fakturor`} style={{ color: 'var(--text)' }}>
          <div className="label">{L('Kunder ska betala')} ({ar.n})</div>
          <div className="value">{kr(ar.v)}</div>
          {ar.overdue > 0 && <div className="small" style={{ color: 'var(--danger)' }}>{L('varav förfallet')} {kr(ar.overdue)}</div>}
        </Link>
        <Link className="card stat" href={`${b}/leverantorsfakturor`} style={{ color: 'var(--text)' }}>
          <div className="label">{L('Du ska betala')} ({ap.n})</div>
          <div className="value">{kr(ap.v)}</div>
          {ap.unapproved > 0 && <div className="small muted">{ap.unapproved} {L('väntar på attest')}</div>}
        </Link>
      </div>
      <p className="small"><Link href={`${b}/rapporter/panel`}>{L('Se diagram och nyckeltal')} →</Link></p>

      <h2>{L("Senaste verifikationer")}</h2>
      {recent.length === 0 ? <p className="muted">{L("Inga verifikationer ännu.")}</p> : (
        <table>
          <tbody>
            {recent.map((v) => (
              <tr key={v.id}><td style={{ width: '5rem' }}><Link href={`${b}/verifikationer/${v.id}`}>{v.series}{v.number}</Link></td><td style={{ width: '7rem' }} className="muted">{v.date}</td><td>{v.description}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
