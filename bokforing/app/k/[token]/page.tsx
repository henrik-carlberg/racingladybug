import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { kr, today } from '@/lib/format';
import { portalByToken, portalInvoices, portalQuotes } from '@/lib/services/portal';
import { payInvoice } from '../../f/[token]/actions';
import { accept, contact } from './actions';
import { PUBLIC, langOf } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'Kundportal' };

export default async function Portal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const p = await portalByToken(token);
  if (!p) notFound();
  const [invoices, quotes] = await Promise.all([portalInvoices(p.company_id, p.customer_id), portalQuotes(p.company_id, p.customer_id)]);
  const t = today();
  const L = PUBLIC[langOf(p.language)];
  const open = invoices.filter((i) => i.status === 'booked');
  const due = open.reduce((s, i) => s + Number(i.remaining), 0);
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 16px' }}>
      <div className="header"><div><h1 style={{ marginBottom: 0 }}>{p.customer}</h1><div className="muted">{L.portalAt(p.company)}</div></div></div>
      {sp.ok && <div className="flash ok">{sp.ok}</div>}
      {sp.fel && <div className="flash error">{sp.fel}</div>}

      <div className="grid">
        <div className="card stat"><div className="label">{L.toPay}</div><div className="value">{kr(due)}</div><div className="small muted">{L.unpaid(open.length)}</div></div>
        <div className="card stat"><div className="label">{L.contact}</div><div className="small">{p.company_email}<br />{p.company_phone}{p.bankgiro && <><br />Bankgiro {p.bankgiro}</>}</div></div>
      </div>

      {quotes.filter((q) => !q.accepted_at).length > 0 && <h2>{L.quotes}</h2>}
      {quotes.map((q) => (
        <div key={q.id} className="card stack">
          <div className="header" style={{ margin: 0 }}><b>{q.title}</b>{q.accepted_at ? <span className="badge ok">{L.accepted(q.accepted_at, q.accepted_by ?? '')}</span> : q.expired ? <span className="badge">{L.expired}</span> : q.valid_to && <span className="small muted">{L.validTo(q.valid_to)}</span>}</div>
          <table className="small"><tbody>{q.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{String(l.quantity).replace('.', ',')} {l.unit}</td><td className="num">{kr(l.unit_price)}</td><td className="num">{kr(Math.round(l.quantity * l.unit_price))}</td></tr>)}
            <tr><td colSpan={3}>{L.vat}</td><td className="num">{kr(q.vat)}</td></tr><tr className="sum"><td colSpan={3}>{L.total}</td><td className="num">{kr(q.total)}</td></tr></tbody></table>
          {q.notes && <p className="small" style={{ margin: 0 }}>{q.notes}</p>}
          {!q.accepted_at && !q.expired && (
            <form action={accept.bind(null, token, q.id)} className="row" style={{ alignItems: 'end' }}>
              <label>{L.yourName}<input name="name" required autoComplete="name" /></label>
              <div style={{ flex: '0 0 auto' }}><button>{L.acceptQuote}</button></div>
            </form>
          )}
        </div>
      ))}

      <h2>{L.invoices}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>{L.invoice}</th><th>{L.date}</th><th>{L.due}</th><th className="num">{L.amount}</th><th>{L.status}</th><th></th></tr></thead>
        <tbody>{invoices.map((i) => (
          <tr key={i.id}>
            <td><a href={`/f/${i.public_token}`}>{i.credit_of_id ? 'Kreditfaktura' : 'Faktura'} {i.number}</a></td><td>{i.invoice_date}</td>
            <td style={i.status === 'booked' && i.due_date < t ? { color: 'var(--danger)' } : undefined}>{i.credit_of_id ? '' : i.due_date}</td>
            <td className="num">{kr(i.total)}{i.status === 'booked' && Number(i.remaining) < Number(i.total) && <div className="small muted">{L.left(kr(i.remaining))}</div>}</td>
            <td>{i.status === 'paid' ? <span className="badge ok">{L.statusPaid}</span> : i.status === 'credited' ? <span className="badge">{L.credited}</span> : i.due_date < t ? <span className="badge danger">{L.statusOverdue}</span> : <span className="badge warn">{L.statusOpen}</span>}</td>
            <td>{i.card && <form action={payInvoice.bind(null, i.public_token!)}><button className="secondary">{L.pay}</button></form>}{i.status === 'booked' && i.ocr && <div className="small muted">OCR {i.ocr}</div>}</td>
          </tr>
        ))}{invoices.length === 0 && <tr><td colSpan={6} className="muted">{L.noInvoices}</td></tr>}</tbody>
      </table></div>

      <details className="card"><summary>{L.updateContact}</summary>
        <form action={contact.bind(null, token)} className="stack" style={{ marginTop: '.5rem' }}>
          <label>E-post för fakturor<input name="email" type="email" defaultValue={p.email} /></label>
          <div className="row"><label style={{ flex: '2 1 240px' }}>{L.address}<input name="address" defaultValue={p.address} /></label><label>{L.postal}<input name="postal_code" defaultValue={p.postal_code} /></label><label>{L.city}<input name="city" defaultValue={p.city} /></label></div>
          <div><button className="secondary">{L.save}</button></div>
        </form>
      </details>
    </main>
  );
}
