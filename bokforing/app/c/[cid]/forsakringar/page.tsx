import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/insurance-policies';
import { addAction, periodizeAction, renewAction } from './actions';

export const dynamic = 'force-dynamic';

const CLAIM: Record<string, string> = { reported: 'anmäld', assessed: 'beviljad', paid: 'utbetald', denied: 'ingen ersättning' };

export default async function Policies({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const { policies, byKind, pending } = await overview(id);
  const t = today();
  const renewals = policies.filter((p) => p.renewalIn != null && !policies.some((q) => q.insurer === p.insurer && q.kind === p.kind && q.start > p.end));
  return (
    <div style={{ maxWidth: 1050 }}>
      <h1>Försäkringar</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Samla bolagets försäkringar med premie, period, självrisk och vad de täcker. Har premien bokförts som kostnad (6310) kan den föras om till förutbetald kostnad (1790) och kostnadsföras månad för månad över perioden.
        Skadeärenden hos samma försäkringsbolag visas vid försäkringen.</p>
      {renewals.map((p) => <div key={p.id} className="card small ins-renewal">{p.kind} hos {p.insurer} löper ut {p.end} (om {p.renewalIn} dagar) – dags att se över villkor och premie inför förnyelsen.</div>)}
      <p className="small">Premie att kostnadsföra fram till i dag: <span className="ins-pending">{kr(pending)}</span> kr</p>
      {pending > 0 && <form action={periodizeAction.bind(null, id)} className="row" style={{ gap: '.25rem' }}><input type="date" name="date" defaultValue={t} /><button>Periodisera premierna</button></form>}
      <table className="ins-list"><thead><tr><th>Försäkring</th><th>Bolag</th><th>Period</th><th className="num">Premie</th><th className="num">Självrisk</th><th className="num">Kostnadsfört</th><th>Skador</th><th></th></tr></thead>
        <tbody>{policies.map((p) => (
          <tr key={p.id} className="ins-row" data-kind={p.kind}><td>{p.kind}{p.policy_no && <div className="small muted">{p.policy_no}</div>}{p.coverage && <div className="small">{p.coverage}</div>}</td><td>{p.insurer}</td>
            <td className="small">{p.start} – {p.end}{!p.active && <div className="muted">{p.end < t ? 'avslutad' : 'kommande'}</div>}</td><td className="num">{kr(p.premium)}</td><td className="num">{kr(p.deductible)}</td>
            <td className="num ins-recognized">{p.prepaid_voucher_id ? kr(p.recognized) : <span className="small muted">kostnadsförd direkt</span>}</td>
            <td className="small ins-claims">{p.claims.map((c, i) => <div key={i}>{c.description} ({CLAIM[c.status] ?? c.status}{c.compensation != null ? `, ${kr(c.compensation)} kr` : ''})</div>)}</td>
            <td>{p.renewalIn != null && <form action={renewAction.bind(null, id, p.id)} className="stack" style={{ gap: '.25rem' }}>
              <input name="premium" placeholder="Ny premie" inputMode="decimal" style={{ width: '7rem' }} required /><input type="date" name="end_date" required /><button className="link">Förnya</button></form>}</td></tr>))}
          {!policies.length && <tr><td colSpan={8} className="muted">Inga försäkringar.</td></tr>}</tbody></table>
      {byKind.length > 0 && <><h2>Årskostnad per försäkring</h2><table><tbody>{byKind.map((k) => <tr key={k.kind}><td>{k.kind}</td><td className="num">{kr(k.yearly)} kr/år</td></tr>)}</tbody></table></>}

      <h2>Ny försäkring</h2>
      <form action={addAction.bind(null, id)} className="card stack ins-add">
        <div className="row">
          <label>Försäkring<input name="kind" required maxLength={100} placeholder="Företagsförsäkring" /></label>
          <label>Försäkringsbolag<input name="insurer" required maxLength={100} /></label>
          <label>Försäkringsnummer<input name="policy_no" maxLength={60} /></label>
        </div>
        <div className="row">
          <label>Premie för perioden<input name="premium" inputMode="decimal" required /></label>
          <label>Gäller från<input type="date" name="start_date" defaultValue={t} required /></label>
          <label>Gäller till<input type="date" name="end_date" required /></label>
          <label>Självrisk<input name="deductible" inputMode="decimal" /></label>
        </div>
        <label>Täcker<input name="coverage" maxLength={500} placeholder="Egendom, ansvar, avbrott …" /></label>
        <label className="small"><input type="checkbox" name="reclass" /> Premien är bokförd som kostnad på 6310 – för om den till förutbetald kostnad (1790) och periodisera den</label>
        <div><button>Spara försäkring</button></div>
      </form>
    </div>
  );
}
