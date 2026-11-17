import Link from 'next/link';
import type { ModuleDefinition, ModulePageProps } from '@/lib/modules/types';
import { kr, today } from '@/lib/format';
import * as svc from './service';
import * as a from './actions';
import { CHANNELS, LEAD_STATUS } from './calc';

const krIn = (ore: number) => (ore ? (ore / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') : '');
const pct = (n: number | null) => (n == null ? '–' : `${String(n).replace('.', ',')} %`);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const CSTATUS: Record<string, [string, string]> = { planned: ['Planerad', ''], active: ['Pågår', 'warn'], done: ['Avslutad', 'ok'] };
const LSTATUS_CLS: Record<string, string> = { new: 'warn', contacted: '', qualified: 'warn', won: 'ok', lost: '' };

function Nav({ basePath }: { basePath: string }) {
  return <p className="small"><Link href={basePath}>Översikt</Link> · <Link href={`${basePath}/kampanjer`}>Kampanjer</Link> · <Link href={`${basePath}/leads`}>Leads</Link></p>;
}

async function Overview({ companyId, basePath, searchParams }: ModulePageProps) {
  const year = Number(searchParams.ar) || Number(today().slice(0, 4));
  const [o, campaigns] = await Promise.all([svc.overview(companyId, year), svc.listCampaigns(companyId)]);
  const active = campaigns.filter((c) => c.status === 'active');
  const max = Math.max(1, ...o.months.flatMap((m) => [m.budget, m.actual]));
  return (
    <>
      <div className="header">
        <h1>Marknadsföring</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn" href={`${basePath}/leads`}>Nytt lead</Link>
          <Link className="btn secondary" href={`${basePath}/kampanjer`}>Ny kampanj</Link>
        </div>
      </div>
      <Nav basePath={basePath} />
      <div className="grid">
        {o.funnel.map((f) => <div key={f.key} className="card stat"><div className="label">{f.label}</div><div className="value">{f.n}</div></div>)}
      </div>
      <div className="grid">
        <div className="card stat"><div className="label">Marknadsbudget {year}</div><div className="value">{kr(o.budget)}</div></div>
        <div className="card stat"><div className="label">Utfall {year} (konto 59xx)</div><div className="value">{kr(o.actual)}</div>
          {o.budget > 0 && <div className="small muted">{pct(Math.round((o.actual / o.budget) * 1000) / 10)} av budget</div>}</div>
        <div className="card stat"><div className="label">Pågående kampanjer</div><div className="value">{active.length}</div></div>
      </div>

      <h2>Budget och utfall per månad {year}</h2>
      <p className="small"><Link href={`${basePath}?ar=${year - 1}`}>← {year - 1}</Link> · <Link href={`${basePath}?ar=${year + 1}`}>{year + 1} →</Link></p>
      <form action={a.saveBudget.bind(null, companyId, year)} className="stack">
        <div className="table-wrap"><table>
          <thead><tr><th>Månad</th><th className="num">Budget (kr)</th><th className="num">Utfall</th><th>Jämförelse</th></tr></thead>
          <tbody>{o.months.map((m) => (
            <tr key={m.month}>
              <td>{MONTHS[m.month - 1]}</td>
              <td className="num"><input name={`m${m.month}`} defaultValue={krIn(m.budget)} inputMode="decimal" aria-label={`Budget ${MONTHS[m.month - 1]}`} style={{ maxWidth: '8rem', textAlign: 'right' }} /></td>
              <td className="num" style={m.budget && m.actual > m.budget ? { color: 'var(--danger)' } : undefined}>{kr(m.actual)}</td>
              <td style={{ minWidth: 160 }}>
                <div title="Budget" style={{ height: 6, width: `${(m.budget / max) * 100}%`, background: 'var(--border)', borderRadius: 3, marginBottom: 3 }} />
                <div title="Utfall" style={{ height: 6, width: `${(m.actual / max) * 100}%`, background: m.budget && m.actual > m.budget ? 'var(--danger)' : 'var(--ok)', borderRadius: 3 }} />
              </td>
            </tr>
          ))}</tbody>
        </table></div>
        <div><button className="secondary">Spara budget</button></div>
        <p className="small muted" style={{ margin: 0 }}>Utfallet hämtas från bokföringen: konton för reklam och PR (5900–5999), exkl. moms. Grå stapel = budget, grön/röd = utfall.</p>
      </form>
    </>
  );
}

async function Campaigns({ companyId, basePath }: ModulePageProps) {
  const campaigns = await svc.listCampaigns(companyId);
  return (
    <>
      <h1>Kampanjer</h1>
      <Nav basePath={basePath} />
      <div className="table-wrap"><table>
        <thead><tr><th>Kampanj</th><th>Kanal</th><th>Period</th><th>Status</th><th className="num">Budget</th><th className="num">Kostnad</th><th className="num">Leads</th><th className="num">Kunder</th><th className="num">Kr/lead</th><th className="num">ROI</th></tr></thead>
        <tbody>
          {campaigns.map((c) => (
            <tr key={c.id}>
              <td><Link href={`${basePath}/kampanjer/${c.id}`}>{c.name}</Link></td><td className="small">{c.channel_label}</td>
              <td className="small">{c.start_date}{c.end_date ? ` – ${c.end_date}` : ''}</td>
              <td><span className={`badge ${CSTATUS[c.status][1]}`}>{CSTATUS[c.status][0]}</span></td>
              <td className="num">{kr(c.budget)}</td><td className="num" style={c.budget && c.cost > c.budget ? { color: 'var(--danger)' } : undefined}>{kr(c.cost)}</td>
              <td className="num">{c.leads}</td><td className="num">{c.won}</td><td className="num">{c.metrics.cpl != null ? kr(c.metrics.cpl) : '–'}</td><td className="num">{pct(c.metrics.roi)}</td>
            </tr>
          ))}
          {campaigns.length === 0 && <tr><td colSpan={10} className="muted">Inga kampanjer ännu.</td></tr>}
        </tbody>
      </table></div>
      <h2>Ny kampanj</h2>
      <CampaignForm companyId={companyId} />
    </>
  );
}

function CampaignForm({ companyId, c }: { companyId: number; c?: svc.CampaignOut }) {
  return (
    <form action={a.saveCampaign.bind(null, companyId, c?.id ?? null)} className="card stack">
      <div className="row">
        <label style={{ flex: '2 1 240px' }}>Namn<input name="name" defaultValue={c?.name} required placeholder="T.ex. Vårkampanj LinkedIn" /></label>
        <label>Kanal<select name="channel" defaultValue={c?.channel ?? 'google'}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={c?.status ?? 'planned'}><option value="planned">Planerad</option><option value="active">Pågår</option><option value="done">Avslutad</option></select></label>
      </div>
      <div className="row">
        <label>Start<input type="date" name="start_date" defaultValue={c?.start_date ?? today()} required /></label>
        <label>Slut<input type="date" name="end_date" defaultValue={c?.end_date ?? ''} /></label>
        <label>Budget exkl. moms (kr)<input name="budget" defaultValue={krIn(c?.budget ?? 0)} inputMode="decimal" /></label>
        <label>Kampanjkod (utm_campaign)<input name="code" defaultValue={c?.code} placeholder="var2027" /></label>
      </div>
      <label>Mål<input name="goal" defaultValue={c?.goal} placeholder="T.ex. 40 leads och 5 nya kunder" /></label>
      <div><button>{c ? 'Spara' : 'Skapa kampanj'}</button></div>
    </form>
  );
}

async function Campaign({ companyId, basePath, params }: ModulePageProps) {
  const c = await svc.getCampaign(companyId, Number(params.id));
  const [costs, candidates, leads] = await Promise.all([svc.campaignCosts(companyId, c.id), svc.costCandidates(companyId, c.id), svc.listLeads(companyId, { campaign_id: c.id })]);
  return (
    <>
      <h1>{c.name} <span className={`badge ${CSTATUS[c.status][1]}`}>{CSTATUS[c.status][0]}</span></h1>
      <Nav basePath={basePath} />
      <p className="small muted">{c.channel_label} · {c.start_date}{c.end_date ? ` – ${c.end_date}` : ''}{c.goal ? ` · Mål: ${c.goal}` : ''}{c.code ? ` · Kod: ${c.code}` : ''}</p>
      <div className="grid">
        <div className="card stat"><div className="label">Kostnad / budget</div><div className="value">{kr(c.cost)}</div><div className="small muted">av {kr(c.budget)} kr ({pct(c.metrics.budgetUsed)})</div></div>
        <div className="card stat"><div className="label">Leads</div><div className="value">{c.leads}</div><div className="small muted">{c.metrics.cpl != null ? `${kr(c.metrics.cpl)} kr per lead` : ''}</div></div>
        <div className="card stat"><div className="label">Nya kunder</div><div className="value">{c.won}</div><div className="small muted">konvertering {pct(c.metrics.conversion)}{c.metrics.cpa != null ? ` · ${kr(c.metrics.cpa)} kr/kund` : ''}</div></div>
        <div className="card stat"><div className="label">Intäkter från nya kunder</div><div className="value">{kr(c.revenue)}</div><div className="small muted">ROI {pct(c.metrics.roi)}</div></div>
      </div>

      <h2>Kostnader</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Beskrivning</th><th>Källa</th><th className="num">Belopp</th><th></th></tr></thead>
        <tbody>
          {costs.map((x) => (
            <tr key={x.id}><td>{x.date}</td><td>{x.description}</td>
              <td className="small">{x.voucher_id ? <Link href={`/c/${companyId}/verifikationer/${x.voucher_id}`}>Verifikation, konto {x.account}</Link> : 'Manuell'}</td>
              <td className="num">{kr(Number(x.amount))}</td>
              <td className="num"><form action={a.removeCost.bind(null, companyId, c.id, x.id)}><button className="link">Ta bort</button></form></td></tr>
          ))}
          {costs.length === 0 && <tr><td colSpan={5} className="muted">Inga kostnader kopplade ännu.</td></tr>}
        </tbody>
      </table></div>
      {candidates.length > 0 && (<>
        <p className="small"><b>Bokförda marknadsföringskostnader under perioden</b> som inte hör till någon kampanj – koppla dem hit:</p>
        <div className="table-wrap"><table>
          <tbody>{candidates.map((x) => (
            <tr key={`${x.voucher_id}-${x.account}`}><td>{x.date}</td><td>{x.ref}</td><td>{x.description}</td><td className="small">konto {x.account}</td><td className="num">{kr(Number(x.amount))}</td>
              <td className="num"><form action={a.linkCost.bind(null, companyId, c.id, x.voucher_id, x.account)}><button className="link">Koppla</button></form></td></tr>
          ))}</tbody>
        </table></div>
      </>)}
      <form action={a.addCost.bind(null, companyId, c.id)} className="card row" style={{ marginTop: '.5rem' }}>
        <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
        <label style={{ flex: '2 1 240px' }}>Annan kostnad (t.ex. del av faktura, material)<input name="description" required /></label>
        <label>Belopp exkl. moms (kr)<input name="amount" inputMode="decimal" required /></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Lägg till</button></div>
      </form>

      <h2>Leads från kampanjen</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Namn</th><th>Företag</th><th>Status</th><th>Registrerad</th></tr></thead>
        <tbody>
          {leads.map((l) => <tr key={l.id}><td><Link href={`${basePath}/leads/${l.id}`}>{l.name}</Link></td><td>{l.company_name}</td><td><span className={`badge ${LSTATUS_CLS[l.status]}`}>{l.status_label}</span></td><td>{l.created_at}</td></tr>)}
          {leads.length === 0 && <tr><td colSpan={4} className="muted">Inga leads ännu.</td></tr>}
        </tbody>
      </table></div>

      <h2>Inställningar</h2>
      <CampaignForm companyId={companyId} c={c} />
    </>
  );
}

async function Leads({ companyId, basePath, searchParams }: ModulePageProps) {
  const [leads, campaigns, purge] = await Promise.all([
    svc.listLeads(companyId, { status: searchParams.status, q: searchParams.q }), svc.listCampaigns(companyId), svc.purgeCandidates(companyId),
  ]);
  return (
    <>
      <h1>Leads</h1>
      <Nav basePath={basePath} />
      <form className="row" style={{ marginBottom: '.5rem' }}>
        <label>Sök<input name="q" defaultValue={searchParams.q ?? ''} placeholder="Namn, företag eller e-post" /></label>
        <label>Status<select name="status" defaultValue={searchParams.status ?? ''}><option value="">Alla</option>{Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}><button className="secondary">Visa</button></div>
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Namn</th><th>Företag</th><th>Kampanj / källa</th><th>Status</th><th className="num">Värde</th><th>Samtycke</th><th>Uppdaterad</th></tr></thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id}><td><Link href={`${basePath}/leads/${l.id}`}>{l.name}</Link></td><td>{l.company_name}</td><td className="small">{l.campaign ?? l.source}</td>
              <td><span className={`badge ${LSTATUS_CLS[l.status]}`}>{l.status_label}</span></td><td className="num">{l.value ? kr(l.value) : ''}</td>
              <td className="small">{l.consent ? `Ja (${l.consent_at})` : 'Nej'}</td><td className="small">{l.updated_at}</td></tr>
          ))}
          {leads.length === 0 && <tr><td colSpan={7} className="muted">Inga leads.</td></tr>}
        </tbody>
      </table></div>
      {purge.length > 0 && (
        <form action={a.purge.bind(null, companyId)} className="card row">
          <span className="small" style={{ flex: '3 1 300px' }}><b>Gallring (GDPR):</b> {purge.length} leads är förlorade eller saknar samtycke och har inte uppdaterats på två år. Personuppgifter ska inte sparas längre än nödvändigt.</span>
          <div style={{ flex: '0 0 auto' }}><button className="secondary">Radera {purge.length} leads</button></div>
        </form>
      )}
      <h2>Nytt lead</h2>
      <form action={a.createLead.bind(null, companyId)} className="card stack">
        <div className="row">
          <label>Namn<input name="name" required /></label><label>Företag<input name="company_name" /></label>
          <label>E-post<input name="email" type="email" /></label><label>Telefon<input name="phone" /></label>
        </div>
        <div className="row">
          <label>Kampanj<select name="campaign_id"><option value="">–</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Källa<input name="source" placeholder="T.ex. webbformulär, mässa, tips" /></label>
          <label>Uppskattat värde (kr)<input name="value" inputMode="decimal" /></label>
        </div>
        <label>Anteckning<input name="notes" /></label>
        <label className="check"><input type="checkbox" name="consent" /> Har samtyckt till att få marknadsföring via e-post</label>
        <div><button>Registrera lead</button></div>
        <p className="small muted" style={{ margin: 0 }}>Leads kan också skickas in automatiskt från ett webbformulär via API:t (POST /api/v1/m/marknad/leads med kampanjkod).</p>
      </form>
    </>
  );
}

async function Lead({ companyId, basePath, params }: ModulePageProps) {
  const l = await svc.getLead(companyId, Number(params.id));
  const campaigns = await svc.listCampaigns(companyId);
  return (
    <>
      <h1>{l.name} <span className={`badge ${LSTATUS_CLS[l.status]}`}>{l.status_label}</span></h1>
      <Nav basePath={basePath} />
      <p className="small">{[l.company_name, l.email, l.phone].filter(Boolean).join(' · ')}<br />
        <span className="muted">Registrerad {l.created_at}{l.source ? ` via ${l.source}` : ''}{l.campaign ? ` · kampanj ${l.campaign}` : ''}.
          Samtycke: {l.consent ? `ja, ${l.consent_at} – ”${l.consent_text}”` : 'nej'}.</span></p>
      {l.customer_id
        ? <p className="card small">Kund sedan {l.won_at}: <Link href={`/c/${companyId}/kunder/${l.customer_id}`}>öppna i kundregistret</Link>. Intäkter från kunden räknas in i kampanjens ROI.</p>
        : <form action={a.convertLead.bind(null, companyId, l.id)} className="card actions"><button>Gör om till kund</button>
            <span className="small muted">Kunden läggs upp i kundregistret och kan faktureras direkt.</span></form>}
      <form action={a.updateLead.bind(null, companyId, l.id)} className="card stack">
        <div className="row">
          <label>Status<select name="status" defaultValue={l.status}>{Object.entries(LEAD_STATUS).filter(([k]) => k !== 'won' || l.customer_id).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Kampanj<select name="campaign_id" defaultValue={l.campaign_id ?? ''}><option value="">–</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Uppskattat värde (kr)<input name="value" defaultValue={krIn(l.value)} inputMode="decimal" /></label>
        </div>
        <label>Anteckningar<textarea name="notes" rows={3} defaultValue={l.notes} /></label>
        <label className="check"><input type="checkbox" name="consent" defaultChecked={l.consent} /> Samtycke till marknadsföring via e-post</label>
        <div><button>Spara</button></div>
      </form>
      <form action={a.deleteLead.bind(null, companyId, l.id)}><button className="link">Radera leadet och dess personuppgifter</button></form>
    </>
  );
}

export const marknad: ModuleDefinition = {
  id: 'marknad',
  name: 'Marknadsföring',
  version: '0.1.0',
  description: 'Kampanjer med budget och kostnader från bokföringen, leads med samtycke som blir kunder, kostnad per lead och ROI, samt marknadsbudget mot utfall.',
  nav: [
    { label: 'Översikt', path: '' },
    { label: 'Kampanjer', path: 'kampanjer' },
    { label: 'Leads', path: 'leads' },
  ],
  pages: { '': Overview, kampanjer: Campaigns, 'kampanjer/:id': Campaign, leads: Leads, 'leads/:id': Lead },
  scopes: [
    { scope: 'marknad:read', description: 'Läsa kampanjer och leads' },
    { scope: 'marknad:write', description: 'Registrera leads (t.ex. från webbformulär) och ändra kampanjer' },
  ],
  events: [
    { type: 'marknad.lead.created', description: 'Ett nytt lead har registrerats' },
    { type: 'marknad.lead.won', description: 'Ett lead har blivit kund' },
  ],
  api: [
    { method: 'GET', path: '/campaigns', scope: 'marknad:read', tag: 'Marknad', summary: 'Lista kampanjer med kostnad, leads och ROI',
      handler: async ({ actor }) => ({ object: 'list', has_more: false, data: await svc.listCampaigns(actor.companyId) }) },
    { method: 'GET', path: '/leads', scope: 'marknad:read', tag: 'Marknad', summary: 'Lista leads', query: [{ name: 'status', description: 'new, contacted, qualified, won, lost' }],
      handler: async ({ actor, query }) => ({ object: 'list', has_more: false, data: await svc.listLeads(actor.companyId, { status: query.get('status') ?? undefined }) }) },
    { method: 'POST', path: '/leads', scope: 'marknad:write', tag: 'Marknad', status: 201, summary: 'Registrera lead (t.ex. från webbformulär)',
      description: 'Ange campaign_code (kampanjens kod/utm_campaign) eller campaign_id för att koppla leadet till en kampanj. consent = true sparar samtycke med tidpunkt och consent_text.',
      body: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, company_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' },
        source: { type: 'string' }, campaign_id: { type: 'integer' }, campaign_code: { type: 'string' }, value: { type: 'integer', description: 'öre' },
        consent: { type: 'boolean' }, consent_text: { type: 'string' }, notes: { type: 'string' } } },
      handler: ({ actor, body }) => svc.createLead(actor, body) },
    { method: 'POST', path: '/leads/:id/convert', scope: 'marknad:write', tag: 'Marknad', summary: 'Gör om lead till kund', body: { type: 'object' },
      handler: ({ actor, params }) => svc.convertLead(actor, Number(params.id)) },
    { method: 'DELETE', path: '/leads/:id', scope: 'marknad:write', tag: 'Marknad', summary: 'Radera lead (GDPR)',
      handler: ({ actor, params }) => svc.deleteLead(actor, Number(params.id)) },
  ],
};
