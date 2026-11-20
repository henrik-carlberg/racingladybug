import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { preview, targets } from '@/lib/services/conversion';
import { convertAction } from './actions';

export const dynamic = 'force-dynamic';

/** Ombildning från enskild firma till aktiebolag: underprisöverlåtelse till bokfört värde och slutlig NE */
export default async function Conversion({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const co = ctx.company;
  if (co.company_type !== 'EF') return <div style={{ maxWidth: 760 }}><h1>Ombildning till aktiebolag</h1><EmptyState icon="briefcase" title="Gäller enskild firma">Ombildningen görs från den enskilda firman. Öppna firman och välj Ombildning där.</EmptyState></div>;
  const sp = await searchParams;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.date)) ? String(sp.date) : today();
  const p = await preview(co.id, at);
  const abs = ctx.role === 'owner' ? await targets(ctx.user.id, co.id) : [];
  const s = p.split;
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Ombildning till aktiebolag</h1>
      <Flash searchParams={searchParams} />
      {p.done && <div className="card conv-done">Verksamheten överläts {p.done.date} till <Link href={`/c/${p.done.ab_id}`}>{p.done.ab}</Link> för {kr(p.done.net)} kr ({p.done.payment === 'debt' ? 'skuld till ägaren' : 'aktieägartillskott'}).</div>}
      <p className="small">Vid en underprisöverlåtelse säljer du firmans tillgångar och skulder till ditt aktiebolag för det bokförda (skattemässiga) värdet. Ingen vinst uppstår och verksamheten fortsätter i bolaget.
        Periodiseringsfonder och expansionsfond återförs i firmans sista deklaration.</p>
      <h2>{p.done ? `Överfört ${p.done.date}` : `Per ${at}`}</h2>
      <table className="conv-items"><thead><tr><th>Konto</th><th className="num">Belopp</th></tr></thead>
        <tbody>{s.items.map((i) => <tr key={i.account} className="conv-item"><td>{i.account}</td><td className="num">{kr(i.amount)}</td></tr>)}
          {!s.items.length && <tr><td colSpan={2} className="muted">Inga tillgångar eller skulder.</td></tr>}</tbody></table>
      <div className="grid">
        <div className="card stat"><div className="label">Tillgångar</div><div className="value">{kr(s.assets)}</div></div>
        <div className="card stat"><div className="label">Skulder</div><div className="value">{kr(s.liabilities)}</div></div>
        <div className="card stat"><div className="label">Köpeskilling (nettovärde)</div><div className="value conv-net">{kr(p.done?.net ?? s.net)}</div></div>
      </div>
      <section className="card stack conv-ne">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Slutlig NE-bilaga</h2>
        <table><tbody>
          <tr><td>Årets resultat inklusive återförda periodiseringsfonder</td><td className="num ne-result">{kr(p.ne.result)}</td></tr>
          <tr><td>varav återförda periodiseringsfonder</td><td className="num ne-pfond">{kr(p.ne.pfondReversed)}</td></tr>
          <tr><td>Återförd expansionsfond (skattepliktig)</td><td className="num ne-expansion">{kr(p.ne.expansionReversed)}</td></tr>
          <tr><td><b>Överskott av näringsverksamhet</b></td><td className="num ne-taxable"><b>{kr(p.ne.taxable)}</b></td></tr>
          <tr><td>Expansionsfondsskatt som tillgodoräknas (20,6 %)</td><td className="num ne-credit">{kr(p.ne.expansionTaxCredit)}</td></tr>
        </tbody></table>
        <p className="small muted" style={{ margin: 0 }}>Uppskovet med periodiseringsfonder och expansionsfond kan i vissa fall föras över till aktiebolaget (inkomstskattelagen 30 kap. 8 § och 34 kap. 20 §) – rådgör med din revisor om det passar bättre.</p>
      </section>
      {!p.done && ctx.role === 'owner' && (abs.length ? (
        <form action={convertAction.bind(null, co.id)} className="card stack conv-form">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Genomför ombildningen</h2>
          <label>Överlåtelsedag<input type="date" name="date" defaultValue={at} required /></label>
          <label>Aktiebolag som tar över<select name="ab_company_id">{abs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>Köpeskillingen<select name="payment"><option value="debt">Skuld till dig i bolaget (2893) – kan tas ut skattefritt senare</option><option value="contribution">Ovillkorat aktieägartillskott (2093) – höjer omkostnadsbeloppet</option></select></label>
          <button>Överlåt verksamheten</button>
        </form>
      ) : <p className="card small">Starta först aktiebolaget i appen (du ska vara ägare där) – sedan kan du överlåta firmans verksamhet till det här.</p>)}
    </div>
  );
}
