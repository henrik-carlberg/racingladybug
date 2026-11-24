import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { SUBJECTS } from '@/lib/tax-audits';
import { overview } from '@/lib/services/tax-audits';
import { answerAction, appealAction, closeAction, decideAction, openAction, requestAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { open: 'Pågår', decided: 'Beslut fattat', appealed: 'Omprövning eller överklagande pågår', closed: 'Avslutat' };

export default async function TaxAudits({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Skatterevision och omprövning</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Följ Skatteverkets revisioner och förfrågningar: begärda handlingar med svarsfrist, revisionspromemorian och beslutet. Beslutet belastar skattekontot (1630) –
        tillkommande skatt som kostnad, skattetillägg på 6992 och kostnadsränta på 8423 (båda ej avdragsgilla). Omprövning eller överklagande ska ha kommit in senast sjätte året efter beskattningsåret.
        Tvistiga belopp ska nämnas i årsredovisningen.</p>
      {o.pending.map((r) => <div key={r.id} className="card small tr-due" data-state={r.state}>{SUBJECTS[r.audit.subject].label} {r.audit.tax_year}: {r.item} – svara senast {r.due_date}{r.state === 'late' ? ' (försenat)' : ''}</div>)}
      {o.disputed > 0 && <p className="small ta-disputed">Tvistiga belopp: {kr(o.disputed)} kr</p>}
      {o.audits.map((a) => (
        <div key={a.id} className="card stack small ta-audit" data-year={a.tax_year} data-subject={a.subject} data-status={a.status}>
          <div><strong>{a.kind === 'revision' ? 'Revision' : 'Förfrågan'}: {SUBJECTS[a.subject].label} {a.tax_year}</strong>{a.reference && ` · ${a.reference}`} · inledd {a.opened_on} · <span className="ta-status">{STATUS[a.status]}</span></div>
          {a.requests.length > 0 && <ul>{a.requests.map((r) => <li key={r.id} data-state={r.state}>{r.item} – senast {r.due_date}{r.answered_on ? ` · besvarad ${r.answered_on}${r.note ? `: ${r.note}` : ''}` : ''}
            {!r.answered_on && <form action={answerAction.bind(null, id, r.id)} style={{ display: 'inline' }}> <input name="note" placeholder="Vad som skickades" /> <button className="link">Besvarad</button></form>}</li>)}</ul>}
          {a.status === 'open' && <form action={requestAction.bind(null, id, a.id)} className="row" style={{ gap: '.25rem' }}><input name="item" placeholder="Begärd handling eller fråga" required style={{ width: '18rem' }} /><input type="date" name="due_date" required /><button className="link">Lägg till begäran</button></form>}
          {a.decision_on && <div className="ta-decision">Beslut {a.decision_on}: skatt {kr(a.tax_amount)} · skattetillägg {kr(a.surcharge)} · ränta {kr(a.interest)} = <strong>{kr(a.total)}</strong> kr{a.voucher_id && <> (<Link href={`/c/${id}/verifikationer/${a.voucher_id}`}>verifikation</Link>)</>}{a.disputed && ' · tvistigt'}</div>}
          {a.status === 'open' && <form action={decideAction.bind(null, id, a.id)} className="row ta-decide" style={{ gap: '.25rem' }}>
            <input type="date" name="memo_on" aria-label="Revisionspromemoria" title="Revisionspromemoria" /><input type="date" name="decision_on" defaultValue={t} required />
            <input name="tax_amount" placeholder="Tillkommande skatt" inputMode="decimal" style={{ width: '9rem' }} /><input name="surcharge" placeholder="Skattetillägg" inputMode="decimal" style={{ width: '8rem' }} /><input name="interest" placeholder="Kostnadsränta" inputMode="decimal" style={{ width: '8rem' }} />
            <label><input type="checkbox" name="disputed" /> Vi bestrider beslutet</label><button className="link">Registrera beslut</button></form>}
          {a.status === 'decided' && <form action={appealAction.bind(null, id, a.id)} className="row" style={{ gap: '.25rem' }}><span>Frist för omprövning och överklagande: {a.appeal_deadline}</span><input type="date" name="appealed_on" defaultValue={t} /><button className="link">Begär omprövning / överklaga</button></form>}
          {(a.status === 'decided' || a.status === 'appealed') && <form action={closeAction.bind(null, id, a.id)} className="row ta-close" style={{ gap: '.25rem' }}><input name="outcome" placeholder="Utfall" required style={{ width: '16rem' }} /><input name="refund" placeholder="Nedsatt belopp" inputMode="decimal" style={{ width: '8rem' }} /><button className="link">Avsluta</button></form>}
          {a.outcome && <div>Utfall: {a.outcome}</div>}
        </div>))}
      {!o.audits.length && <p className="muted">Inga ärenden.</p>}
      <h2>Nytt ärende</h2>
      <form action={openAction.bind(null, id)} className="card row ta-new">
        <label>Typ<select name="kind"><option value="revision">Revision</option><option value="inquiry">Förfrågan</option></select></label>
        <label>Gäller<select name="subject">{Object.entries(SUBJECTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label>Beskattningsår<input name="tax_year" inputMode="numeric" required style={{ width: '5rem' }} /></label>
        <label>Diarienummer<input name="reference" maxLength={60} /></label>
        <label>Inledd<input type="date" name="opened_on" defaultValue={t} required /></label>
        <button>Registrera ärende</button>
      </form>
    </div>
  );
}
