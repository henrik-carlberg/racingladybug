import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, EmptyState, type SP } from '@/components/ui';
import { authorityEnabled, authorityFor } from '@/lib/server/authorities';
import { KIND_LABEL, listFilings } from '@/lib/services/filings';
import { markFiled, refresh, submit } from './actions';
import { isVerified } from '@/lib/services/identity';

export const dynamic = 'force-dynamic';
const ST: Record<string, [string, string]> = { prepared: ['Förberedd', 'warn'], submitted: ['Inlämnad – väntar på besked', 'warn'], accepted: ['Godkänd', 'ok'], rejected: ['Avvisad', 'danger'] };
const ETJANST: Record<string, string> = { moms: 'Skatteverkets e-tjänst Moms- och arbetsgivardeklarationer → Lämna momsdeklaration via fil', agi: 'Skatteverkets e-tjänst Arbetsgivardeklaration → Lämna via fil', arsredovisning: 'Bolagsverkets e-tjänst Lämna årsredovisning digitalt' };

export default async function Filings({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid);
  const b = `/c/${ctx.company.id}`;
  const verified = await isVerified(ctx.company.id);
  const all = (await listFilings(ctx.company.id)).filter((f) => ctx.can(f.kind === 'agi' ? 'payroll' : 'ledger'));
  return (
    <div style={{ maxWidth: 980 }}>
      <h1>Inlämning till myndigheter</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Momsdeklaration och arbetsgivardeklaration till Skatteverket och årsredovisning till Bolagsverket. {authorityEnabled('skv') || authorityEnabled('bv') ? 'Direktinlämning är uppsatt för ' + [authorityEnabled('skv') && 'Skatteverket', authorityEnabled('bv') && 'Bolagsverket'].filter(Boolean).join(' och ') + '.' : 'Direktinlämning är inte uppsatt än: ladda ner filen, lämna den i myndighetens e-tjänst och skriv in kvittensnumret här, så bockas deadlinen av.'}</p>
      {(authorityEnabled('skv') || authorityEnabled('bv')) && !verified && <p className="card small unverified">Direktinlämning kräver att bolagets organisationsnummer är verifierat (att du företräder bolaget). <Link href={`${b}/installningar/verifiering`}>Verifiera bolaget med BankID</Link> – till dess lämnar du filen i myndighetens e-tjänst och registrerar kvittensen här.</p>}
      <div className="actions"><Link className="btn secondary" href={`${b}/rapporter/moms`}>Förbered moms</Link><Link className="btn secondary" href={`${b}/lon`}>Förbered AGI (från en lönekörning)</Link><Link className="btn secondary" href={`${b}/bokslut`}>Årsredovisning</Link></div>
      {all.length === 0 && <EmptyState icon="calendar" title="Inga inlämningar än">Förbered en momsdeklaration från momsrapporten, en arbetsgivardeklaration från en bokförd lönekörning eller årsredovisningen från bokslutet.</EmptyState>}
      {all.map((f) => {
        const api = verified && authorityEnabled(authorityFor(f.kind));
        return (
          <section key={f.id} className="card filing">
            <div className="header" style={{ marginBottom: '.4rem' }}>
              <div><b>{KIND_LABEL[f.kind]}</b> <span className="muted">{f.period.replace(':', ' – ')}</span></div>
              <span className={`badge ${ST[f.status][1]}`}>{ST[f.status][0]}</span>
            </div>
            <div className="small muted">Förberedd {f.created_at}{f.submitted_at ? ` · inlämnad ${f.submitted_at} ${f.method === 'api' ? 'direkt' : 'via e-tjänst'}` : ''}{f.receipt ? ` · kvittens ${f.receipt}` : ''} · kontrollsumma {f.sha256.slice(0, 12)}…</div>
            {f.message && <div className="small" style={{ marginTop: '.3rem' }}>{f.message}</div>}
            <div className="actions" style={{ margin: '.5rem 0 0' }}>
              <a className="btn secondary" href={`${b}/inlamning/${f.id}/fil`} download>Ladda ner {f.filename}</a>
              {(f.status === 'prepared' || f.status === 'rejected') && api && <form action={submit.bind(null, ctx.company.id, f.id)}><button>Lämna in direkt</button></form>}
              {f.status === 'submitted' && <form action={refresh.bind(null, ctx.company.id, f.id)}><button className="secondary">Hämta status</button></form>}
            </div>
            {(f.status === 'prepared' || f.status === 'rejected') && (
              <form action={markFiled.bind(null, ctx.company.id, f.id)} className="row" style={{ alignItems: 'end', marginTop: '.5rem' }}>
                <label style={{ flex: '2 1 280px' }}>Lämnad via e-tjänsten? Kvittensnummer<input name="receipt" placeholder="T.ex. 1234567890" /></label>
                <div style={{ flex: '0 0 auto' }}><button className="secondary">Registrera som inlämnad</button></div>
                <span className="small muted" style={{ flexBasis: '100%' }}>{ETJANST[f.kind]}.</span>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
