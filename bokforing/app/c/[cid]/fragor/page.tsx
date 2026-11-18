import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { listQuestions } from '@/lib/services/firms';
import { answer, ask, close } from './actions';

export const dynamic = 'force-dynamic';

const LINK: Record<string, (cid: number, id: number) => string> = {
  bank_transaction: (c, id) => `/c/${c}/bank/avstamning#t${id}`, voucher: (c, id) => `/c/${c}/verifikationer/${id}`,
  supplier_invoice: (c, id) => `/c/${c}/leverantorsfakturor/${id}`, invoice: (c, id) => `/c/${c}/fakturor/${id}`,
};

export default async function Questions({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid);
  const sp = await searchParams;
  const all = await listQuestions(company.id);
  const open = all.filter((q) => q.status === 'open');
  const answered = all.filter((q) => q.status === 'answered');
  const closed = all.filter((q) => q.status === 'closed');
  const accountant = role === 'accountant';
  const entity = typeof sp.entity === 'string' ? sp.entity : '';
  const entityId = typeof sp.id === 'string' ? sp.id : '';
  const ctx = (q: (typeof all)[number]) => q.entity && q.entity_id ? <div className="small"><Link href={LINK[q.entity](company.id, q.entity_id)}>{q.context || 'Visa'}</Link></div> : null;
  return (
    <div style={{ maxWidth: 860 }}>
      <h1>Frågor och svar</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">{accountant ? 'Ställ frågor till kunden om transaktioner och underlag. Kunden ser dem i sin att göra-lista.' : 'Frågor från din redovisningsbyrå. Svara direkt här – svaret syns för byrån.'}</p>
      <form action={ask.bind(null, company.id)} className="card stack">
        <input type="hidden" name="entity" value={entity} /><input type="hidden" name="entity_id" value={entityId} />
        <label>{entity ? 'Fråga om den markerade transaktionen' : 'Ny fråga'}<textarea name="question" rows={2} required placeholder={accountant ? 'T.ex. Vad gäller betalningen på 2 450 kr till Bauhaus? Finns kvitto?' : 'Fråga byrån'} /></label>
        <div><button className="secondary">Skicka fråga</button></div>
      </form>

      <h2>Obesvarade ({open.length})</h2>
      {open.map((q) => (
        <div key={q.id} className="card stack" id={`q${q.id}`}>
          <div><b>{q.question}</b><div className="small muted">{q.asked_by}{q.firm ? ` (${q.firm})` : ''} · {q.created_at}</div>{ctx(q)}</div>
          <form action={answer.bind(null, company.id, q.id)} className="stack">
            <textarea name="answer" rows={2} required aria-label="Svar" />
            <div className="actions" style={{ margin: 0 }}><button>Svara</button></div>
          </form>
          <form action={close.bind(null, company.id, q.id)}><button className="link small">Avsluta utan svar</button></form>
        </div>
      ))}
      {open.length === 0 && <p className="small muted">Inga obesvarade frågor.</p>}

      <h2>Besvarade ({answered.length})</h2>
      {answered.map((q) => (
        <div key={q.id} className="card">
          <b>{q.question}</b>{ctx(q)}
          <p style={{ margin: '.4rem 0' }}>{q.answer}</p>
          <div className="small muted">Svar av {q.answered_by} · {q.answered_at}</div>
          <form action={close.bind(null, company.id, q.id)}><button className="link small">Klar – avsluta</button></form>
        </div>
      ))}
      {closed.length > 0 && <details><summary>Avslutade ({closed.length})</summary>{closed.map((q) => <div key={q.id} className="small" style={{ padding: '.3rem 0' }}><b>{q.question}</b> – {q.answer || 'utan svar'}</div>)}</details>}
    </div>
  );
}
