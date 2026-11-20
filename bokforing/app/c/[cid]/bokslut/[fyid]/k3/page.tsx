import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { deferredStatus, framework, k3Explanation } from '@/lib/services/k3';
import { addDiff, book, removeDiff, switchFramework } from './actions';

export const dynamic = 'force-dynamic';

export default async function K3Page({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, fy = Number(fyid), owner = ctx.role === 'owner';
  const f = await framework(id);
  const ex = await k3Explanation(id, fy).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const d = await deferredStatus(id, fy);
  const b = `/c/${id}/bokslut/${fy}`;
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="header"><h1>Regelverk: <span className="framework">{f.accounting_framework}</span></h1><Link className="btn secondary" href={b}>Tillbaka</Link></div>
      <Flash searchParams={searchParams} />
      {f.accounting_framework === 'K2' ? (<>
        <p>K2 (BFNAR 2016:10) är ett förenklat regelverk för mindre aktiebolag. K3 (BFNAR 2012:1) är huvudregelverket – det ger en mer rättvisande bild när bolaget har byggnader, större investeringar eller temporära skattemässiga skillnader, och krävs för större företag.</p>
        <h2>Det här ändras för bolaget vid byte till K3</h2>
        <ol className="k3-changes">{ex.changes.map((c) => <li key={c.title}><b>{c.title}.</b> {c.detail}</li>)}</ol>
        <p className="small muted">Bytet gäller från räkenskapsårets början. Byte tillbaka till K2 kräver särskilda skäl och kan bara göras från ett nytt räkenskapsår.</p>
        {owner ? <form action={switchFramework.bind(null, id, fy)} className="card stack"><input type="hidden" name="framework" value="K3" />
          <label className="check"><input type="checkbox" name="confirm" /> Jag har läst vad bytet innebär</label>
          <div><button>Byt till K3</button></div></form> : <p>Ägaren byter regelverk.</p>}
      </>) : (<>
        <p>Bolaget tillämpar K3 sedan {f.k3_from}. Årsredovisningen får kassaflödesanalys och utökade noter, och byggnader skrivs av per komponent.</p>
        <p><Link href={`${b}/kassaflode`}>Kassaflödesanalys per månad och år</Link> · <Link href={`${b}/arsredovisning`}>Årsredovisning (K3)</Link></p>
        <h2>Uppskjuten skatt</h2>
        <p className="small muted">Ange temporära skillnader: bokfört värde minus skattemässigt värde. Positivt belopp ger uppskjuten skatteskuld (2240), negativt – t.ex. underskottsavdrag – ger uppskjuten skattefordran (1370). Skattesats 20,6 %.</p>
        {d.diffs.length > 0 && <table className="diffs"><thead><tr><th>Post</th><th className="num">Skillnad</th><th className="num">Uppskjuten skatt</th><th></th></tr></thead>
          <tbody>{d.target.rows.map((r, i) => <tr key={d.diffs[i].id} className="diff"><td>{r.label}</td><td className="num">{kr(r.amount)}</td><td className="num">{kr(r.tax)}</td>
            <td><form action={removeDiff.bind(null, id, fy, d.diffs[i].id)}><button className="secondary">Ta bort</button></form></td></tr>)}</tbody></table>}
        <form action={addDiff.bind(null, id, fy)} className="row"><label style={{ flex: '2 1 240px' }}>Post<input name="label" required placeholder="Byggnad: bokfört över skattemässigt värde" /></label><label>Skillnad (kr)<input name="amount" inputMode="decimal" required /></label><button className="secondary">Lägg till</button></form>
        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card stat"><div className="label">Uppskjuten skatteskuld</div><div className="value dt-liability">{kr(d.target.liability)}</div><div className="small muted">bokfört {kr(d.current.liability)}</div></div>
          <div className="card stat"><div className="label">Uppskjuten skattefordran</div><div className="value dt-asset">{kr(d.target.asset)}</div><div className="small muted">bokfört {kr(d.current.asset)}</div></div>
          <div className="card stat"><div className="label">I obeskattade reserver</div><div className="value">{kr(ex.deferredInUntaxed)}</div><div className="small muted">upplyses i not</div></div>
        </div>
        {d.entry.length > 0 && <form action={book.bind(null, id, fy)} className="card stack" style={{ marginTop: 16 }}>
          <div className="small">Verifikation per {d.fy.end_date}: {d.entry.map((l) => `${l.account} ${l.amount > 0 ? 'debet' : 'kredit'} ${kr(Math.abs(l.amount))}`).join(', ')}</div>
          <div><button>Bokför uppskjuten skatt</button></div></form>}
        {owner && <form action={switchFramework.bind(null, id, fy)} style={{ marginTop: 32 }}><input type="hidden" name="framework" value="K2" /><button className="secondary">Byt tillbaka till K2</button></form>}
      </>)}
    </div>
  );
}
