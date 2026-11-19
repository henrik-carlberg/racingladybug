import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { sql } from '@/lib/db';
import { Flash, type SP } from '@/components/ui';
import { Wheel } from '@/components/Wheel';
import { today } from '@/lib/format';
import { requestOrigin } from '@/lib/server/origin';
import { isWheelModule, itemStatus, moduleIndex, RECURRENCE_LABEL, WHEEL_MODULES, type WheelModule } from '@/lib/wheel';
import { hasCalendarToken, listActivities, wheelItems } from '@/lib/services/wheel';
import { deleteActivity, newCalendarLink, saveActivity, toggleItem } from './actions';

export const dynamic = 'force-dynamic';
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const ST: Record<string, [string, string]> = { done: ['Klar', 'ok'], overdue: ['Försenad', 'danger'], soon: ['Snart', 'warn'], upcoming: ['Kommande', ''] };
const WEEKDAYS = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

export default async function YearWheel({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid);
  const b = `/c/${ctx.company.id}`;
  const t = today();
  const view = sp.vy === 'manad' ? 'month' : sp.vy === 'lista' ? 'list' : 'year';
  const year = Number(sp.ar) >= 2000 && Number(sp.ar) <= 2100 ? Number(sp.ar) : Number(t.slice(0, 4));
  const month = Number(sp.manad) >= 1 && Number(sp.manad) <= 12 ? Number(sp.manad) : Number(t.slice(5, 7));
  const raw = sp.m == null ? [] : Array.isArray(sp.m) ? sp.m : [sp.m];
  const chosen = raw.filter(isWheelModule) as WheelModule[];
  const from = view === 'month' ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`;
  const to = view === 'month' ? new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) : `${year}-12-31`;
  const all = await wheelItems(ctx.company.id, from, to);
  const present = WHEEL_MODULES.map((m) => m.key).filter((k) => all.some((i) => i.module === k)) as WheelModule[];
  const modules = chosen.length ? chosen : present;
  const items = all.filter((i) => modules.includes(i.module));
  const mq = modules.length && chosen.length ? modules.map((m) => `m=${m}`).join('&') : '';
  const q = (o: Record<string, string | number>) => `${b}/arshjul?${[...Object.entries(o).map(([k, v]) => `${k}=${v}`), mq].filter(Boolean).join('&')}`;
  const here = view === 'month' ? q({ vy: 'manad', ar: year, manad: month }) : view === 'list' ? q({ vy: 'lista', ar: year }) : q({ ar: year });
  const prev = view === 'month' ? q({ vy: 'manad', ar: month === 1 ? year - 1 : year, manad: month === 1 ? 12 : month - 1 }) : q({ vy: view === 'list' ? 'lista' : 'ar', ar: year - 1 });
  const next = view === 'month' ? q({ vy: 'manad', ar: month === 12 ? year + 1 : year, manad: month === 12 ? 1 : month + 1 }) : q({ vy: view === 'list' ? 'lista' : 'ar', ar: year + 1 });
  const acts = await listActivities(ctx.company.id);
  const users = await sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${ctx.company.id} ORDER BY u.name`;
  const origin = await requestOrigin();
  const calToken = typeof sp.kalender === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(sp.kalender) ? sp.kalender : null;
  const hasCal = await hasCalendarToken(ctx.user.id, ctx.company.id);
  const groups = view === 'month' ? [[`${MONTHS[month - 1]} ${year}`, items] as const] : MONTHS.map((n, i) => [`${n} ${year}`, items.filter((x) => Number(x.date.slice(5, 7)) === i + 1)] as const).filter(([, l]) => l.length);
  const label = (k: WheelModule) => WHEEL_MODULES.find((m) => m.key === k)!.label;
  return (
    <div style={{ maxWidth: 1100 }}>
      <div className="header">
        <h1>Årshjul</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className={`btn ${view === 'year' ? '' : 'secondary'}`} href={q({ ar: year })}>År</Link>
          <Link className={`btn ${view === 'month' ? '' : 'secondary'}`} href={q({ vy: 'manad', ar: year, manad: view === 'month' ? month : Number(t.slice(5, 7)) })}>Månad</Link>
          <Link className={`btn ${view === 'list' ? '' : 'secondary'}`} href={q({ vy: 'lista', ar: year })}>Lista</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <p className="muted">Allt som återkommer under året, per modul: deklarationer, löner, bokslut, avtal, projekt, kampanjer och dina egna aktiviteter. Bocka av det som är gjort – deadlines bockas samtidigt av i deadlinelistan.</p>
      <form className="card row wheel-filter" style={{ alignItems: 'end' }}>
        <input type="hidden" name="vy" value={view === 'month' ? 'manad' : view === 'list' ? 'lista' : 'ar'} />
        <input type="hidden" name="ar" value={year} />{view === 'month' && <input type="hidden" name="manad" value={month} />}
        {WHEEL_MODULES.map((m) => (
          <label key={m.key} className="check"><input type="checkbox" name="m" value={m.key} defaultChecked={modules.includes(m.key)} /> <i className="swatch" style={{ background: `var(--wheel-${moduleIndex(m.key) + 1})` }} /> {m.label}</label>
        ))}
        <div><button className="secondary">Visa</button> <Link href={`${b}/arshjul?vy=${view === 'month' ? 'manad' : view === 'list' ? 'lista' : 'ar'}&ar=${year}${view === 'month' ? `&manad=${month}` : ''}`}>Alla</Link></div>
      </form>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <Link className="btn secondary" href={prev}>← Föregående</Link>
        <b>{view === 'month' ? `${MONTHS[month - 1]} ${year}` : year}</b>
        <Link className="btn secondary" href={next}>Nästa →</Link>
      </div>
      {view !== 'list' && (items.length ? <Wheel items={items} view={view} year={year} month={month} modules={modules} today={t} base={`${b}/arshjul?${mq}`} /> : <p className="muted">Inga aktiviteter i perioden för de valda modulerna.</p>)}

      <h2>{view === 'month' ? 'Månadens aktiviteter' : 'Aktiviteter per månad'}</h2>
      {groups.map(([g, list]) => (
        <section key={g} className="wheel-month">
          <h3>{g}</h3>
          <table>
            <tbody>{list.map((i) => {
              const s = itemStatus(i, t);
              return (
                <tr key={i.key} className={`wheel-item ${s}`}>
                  <td style={{ width: 110 }}>{i.date}</td>
                  <td><i className="swatch" style={{ background: `var(--wheel-${moduleIndex(i.module) + 1})` }} /> <span className="small muted">{label(i.module)}</span></td>
                  <td>{i.href ? <Link href={i.href}>{i.title}</Link> : i.title}{i.owner && <span className="small muted"> · {i.owner}</span>}</td>
                  <td><span className={`badge ${ST[s][1]}`}>{ST[s][0]}</span></td>
                  <td className="num"><form action={toggleItem.bind(null, ctx.company.id, here, i.key, !i.done)}><button className="link">{i.done ? 'Ångra' : 'Markera klar'}</button></form></td>
                </tr>
              );
            })}</tbody>
          </table>
        </section>
      ))}

      <h2>Egna återkommande aktiviteter</h2>
      {acts.length > 0 && (
        <table>
          <thead><tr><th>Aktivitet</th><th>Modul</th><th>Hur ofta</th><th>Ansvarig</th><th /></tr></thead>
          <tbody>{acts.map((a) => (
            <tr key={a.id}>
              <td>{a.title}{a.description && <div className="small muted">{a.description}</div>}</td>
              <td>{label(a.module)}</td>
              <td>{RECURRENCE_LABEL[a.recurrence]}{a.recurrence === 'weekly' ? `, ${WEEKDAYS[(a.day ?? 1) - 1]}` : a.recurrence === 'once' ? ` ${a.start_date}` : a.recurrence === 'yearly' ? `, ${a.day ?? ''} ${MONTHS[(a.month ?? 1) - 1]}` : a.recurrence === 'quarterly' ? `, dag ${a.day ?? 1} i kvartalets ${['första', 'andra', 'tredje'][(a.month ?? 1) - 1]} månad` : `, dag ${a.day ?? 1}`}{a.end_date ? ` t.o.m. ${a.end_date}` : ''}</td>
              <td>{a.owner ?? '–'}{a.owner && <div className="small muted">påminnelse {a.remind_days} dagar före</div>}</td>
              <td className="num"><form action={deleteActivity.bind(null, ctx.company.id, here, a.id)}><button className="link">Ta bort</button></form></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <form action={saveActivity.bind(null, ctx.company.id, here)} className="card stack new-activity">
        <div className="row">
          <label style={{ flex: '2 1 260px' }}>Vad ska göras?<input name="title" required placeholder="T.ex. Lönesamtal, Inventering, Avstämning med banken" /></label>
          <label>Modul<select name="module" defaultValue="allmant">{WHEEL_MODULES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
        </div>
        <div className="row">
          <label>Hur ofta<select name="recurrence" defaultValue="monthly">{Object.entries(RECURRENCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Dag (i månaden, eller veckodag 1–7)<input name="day" inputMode="numeric" placeholder="T.ex. 5" /></label>
          <label>Månad (för varje år 1–12, för kvartal 1–3)<input name="month" inputMode="numeric" /></label>
        </div>
        <div className="row">
          <label>Från<input type="date" name="start_date" defaultValue={t} /></label>
          <label>Till och med (valfritt)<input type="date" name="end_date" /></label>
          <label>Ansvarig<select name="owner_user_id" defaultValue={ctx.user.id}><option value="">Ingen</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label>Påminn dagar före<input name="remind_days" inputMode="numeric" defaultValue="3" /></label>
        </div>
        <label>Beskrivning (valfritt)<input name="description" /></label>
        <div><button>Lägg till i årshjulet</button></div>
      </form>

      <h2 id="kalender">Kalender</h2>
      <div className="card stack small">
        <p style={{ margin: 0 }}>Prenumerera på årshjulet i Outlook, Google Kalender eller Apple Kalender. Länken är personlig – den som har den ser bolagets aktiviteter. Skapar du en ny länk slutar den gamla att fungera.</p>
        {calToken && <div>Kalenderlänk: <code className="calendar-url">{`${origin}/kalender?t=${calToken}`}</code></div>}
        <form action={newCalendarLink.bind(null, ctx.company.id)}><button className="secondary">{hasCal ? 'Skapa ny kalenderlänk' : 'Skapa kalenderlänk'}</button></form>
      </div>
    </div>
  );
}
