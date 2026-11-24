import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { variance } from '@/lib/board-package';
import { overview } from '@/lib/services/board-package';
import { commentAction, createAction, sendAction } from './actions';

export const dynamic = 'force-dynamic';
const DOC: Record<string, string> = { pending: 'skickat – väntar på kvittens', completed: 'alla har tagit del', declined: 'avböjt', cancelled: 'makulerat' };

export default async function BoardPackages({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const list = await overview(id);
  const v = (a: number, b: number) => { const x = variance(a, b); return `${kr(x.diff)}${x.pct != null ? ` (${x.pct.toLocaleString('sv-SE')} %)` : ''}`; };
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Styrelsepaket</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Ett paket till styrelsen för månaden eller kvartalet: resultat mot budget, kassa, nyckeltal och utlösta <Link href={`/c/${id}/nyckeltal/larm`}>larm</Link>, beslut från <Link href={`/c/${id}/styrelsemoten`}>styrelsemötena</Link> som inte är genomförda
        och läget i <Link href={`/c/${id}/internkontroll`}>internkontrollen</Link>. Paketet sparas som en ögonblicksbild och skickas till ledamöterna, som kvitterar att de har tagit del av det.</p>
      <form action={createAction.bind(null, id)} className="card row bp-new">
        <label>Period<select name="kind"><option value="month">Förra månaden</option><option value="quarter">Senaste kvartalet</option><option value="custom">Egen period</option></select></label>
        <label>Från<input type="date" name="from" /></label><label>Till<input type="date" name="to" /></label>
        <label>VD:s kommentar<input name="comment" maxLength={4000} style={{ width: '20rem' }} /></label>
        <button>Skapa styrelsepaket</button>
      </form>
      {list.map((p) => { const d = p.data; return (
        <div key={p.id} className="card stack small bp-package" data-from={p.from} data-to={p.to}>
          <div><strong>{p.from} – {p.to}</strong>{p.document_id && <> · <span className="bp-status">{DOC[p.doc_status ?? ''] ?? 'skickat'}</span> · <Link href={`/c/${id}/dokument/${p.document_id}`}>dokumentet</Link></>}</div>
          {p.comment && <div>VD:s kommentar: {p.comment}</div>}
          <table className="bp-result"><thead><tr><th></th><th className="num">Utfall</th><th className="num">Budget</th><th className="num">Avvikelse</th></tr></thead><tbody>
            <tr><td>Intäkter</td><td className="num">{kr(d.result.revenue)}</td><td className="num">{kr(d.result.budgetRevenue)}</td><td className="num">{v(d.result.revenue, d.result.budgetRevenue)}</td></tr>
            <tr><td>Kostnader</td><td className="num">{kr(d.result.costs)}</td><td className="num">{kr(d.result.budgetCosts)}</td><td className="num">{v(d.result.costs, d.result.budgetCosts)}</td></tr>
            <tr className="bp-row-result"><td><strong>Resultat</strong></td><td className="num">{kr(d.result.result)}</td><td className="num">{kr(d.result.budgetResult)}</td><td className="num">{v(d.result.result, d.result.budgetResult)}</td></tr></tbody></table>
          <div>Kassa och bank: <span className="bp-cash">{kr(d.cash)}</span> kr · {d.kpis.map((k) => `${k.label} ${k.value}`).join(' · ')}</div>
          {d.alerts.length > 0 && <div className="bp-alerts">Larm: {d.alerts.join('; ')}</div>}
          <div className="bp-decisions">Beslut att följa upp: {d.decisions.length ? d.decisions.map((x) => `${x.title}: ${x.decision}${x.overdue ? ' (försenat)' : ''}`).join('; ') : 'inga'}</div>
          <div className="bp-control">Internkontroll: {d.control.missing} kontroller saknas{d.control.deviations.length ? ` · avvikelser: ${d.control.deviations.join('; ')}` : ''}{d.risks.length ? ` · höga risker: ${d.risks.map((r) => r.description).join('; ')}` : ''}</div>
          {p.comments.length > 0 && <ul className="bp-comments">{p.comments.map((c, i) => <li key={i}><b>{c.name ?? 'Okänd'}</b>: {c.body}</li>)}</ul>}
          <form action={commentAction.bind(null, id, p.id)} className="row" style={{ gap: '.25rem' }}><input name="body" placeholder="Kommentar" required style={{ width: '22rem' }} /><button className="link">Kommentera</button></form>
          {!p.document_id && <form action={sendAction.bind(null, id, p.id)} className="stack bp-send" style={{ gap: '.25rem' }}><textarea name="recipients" rows={2} placeholder={'Anna Andersson anna@exempel.se\nBo Berg bo@exempel.se'} required /><div><button className="link">Skicka till styrelsen</button></div></form>}
        </div>); })}
      {!list.length && <p className="muted">Inga styrelsepaket.</p>}
    </div>
  );
}
