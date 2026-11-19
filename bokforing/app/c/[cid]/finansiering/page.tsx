import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { factoringConfigured } from '@/lib/server/factoring';
import { creditOverview, factoringCandidates, listLoans, loanRows } from '@/lib/services/finance';
import { accept, addLoan, bookDue, credit, offer, rate, refresh } from './actions';

export const dynamic = 'force-dynamic';
const DEAL: Record<string, string> = { offered: 'Erbjudande', accepted: 'Accepterat – väntar på utbetalning', funded: 'Såld och utbetald', rejected: 'Avböjd', cancelled: 'Avbruten' };

export default async function Finance({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, sp = await searchParams;
  const [{ loans, reconciliation }, credits, accounts] = await Promise.all([listLoans(id), creditOverview(id), sql<{ id: number; name: string }[]>`SELECT id, name FROM bank_accounts WHERE company_id = ${id} ORDER BY name`]);
  const sel = Number(sp.lan) || loans[0]?.id;
  const rows = sel ? await loanRows(id, sel).catch(() => []) : [];
  const fact = factoringConfigured() ? await factoringCandidates(id) : [];
  const due = loans.some((l) => l.next_date && l.next_date <= today());
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Lån och finansiering</h1>
      <Flash searchParams={searchParams} />
      <h2>Lån</h2>
      <div className="table-wrap"><table className="loans"><thead><tr><th>Lån</th><th>Ränta</th><th className="num">Kvar att betala</th><th>Nästa betalning</th><th className="num">Belopp</th></tr></thead>
        <tbody>{loans.map((l) => <tr key={l.id} className="loan"><td><Link href={`?lan=${l.id}`}><b>{l.name}</b></Link><div className="small muted">{l.lender} · {l.type === 'annuity' ? 'annuitet' : 'rak amortering'} · {l.months} mån · konto {l.loan_account}</div></td>
          <td>{String(l.rate_pct).replace('.', ',')} %</td><td className="num">{kr(l.balance)}</td><td>{l.next_date ?? 'Slutbetalt'}</td><td className="num">{l.next_payment != null ? kr(l.next_payment) : ''}</td></tr>)}
          {loans.length === 0 && <tr><td colSpan={5} className="muted">Inga lån ännu – lägg upp det första i formuläret nedan.</td></tr>}</tbody></table></div>
      {reconciliation.map((r) => <p key={r.account} className="small loan-recon">Konto {r.account}: bokfört <b>{kr(r.ledger)}</b>, enligt lånen <b>{kr(r.loans)}</b> {Math.abs(r.ledger - r.loans) < 100 ? '✅ stämmer' : `⚠️ skillnad ${kr(r.ledger - r.loans)}`}</p>)}
      {due && <form action={bookDue.bind(null, id)} className="card actions"><span>Det finns förfallna betalningar som inte är bokförda (de bokförs annars i natt).</span><button className="secondary">Bokför nu</button></form>}
      {sel && rows.length > 0 && (<>
        <h3>Amorteringsplan: {loans.find((l) => l.id === sel)?.name}</h3>
        <form action={rate.bind(null, id, sel)} className="row" style={{ alignItems: 'end', maxWidth: 480 }}><label>Ny ränta (%) från nästa betalning<input name="rate_pct" inputMode="decimal" required /></label>
          <div style={{ flex: '0 0 auto' }}><button className="secondary">Ändra räntan</button></div></form>
        <div className="table-wrap"><table className="small loan-rows"><thead><tr><th>#</th><th>Datum</th><th className="num">Ränta</th><th className="num">Amortering</th><th className="num">Att betala</th><th className="num">Skuld efter</th><th></th></tr></thead>
          <tbody>{rows.slice(0, 36).map((r) => <tr key={r.n}><td>{r.n}</td><td>{r.date}</td><td className="num">{kr(r.interest)}</td><td className="num">{kr(r.amortization)}</td><td className="num">{kr(r.interest + r.amortization)}</td><td className="num">{kr(r.balance)}</td>
            <td>{r.voucher_id ? <Link href={`/c/${id}/verifikationer/${r.voucher_id}`}>Bokförd</Link> : ''}</td></tr>)}</tbody></table></div>
      </>)}
      <form action={addLoan.bind(null, id)} className="card stack">
        <b>Nytt lån</b>
        <div className="row"><label style={{ flex: '2 1 200px' }}>Namn<input name="name" required placeholder="T.ex. Företagslån bil" /></label><label>Långivare<input name="lender" /></label>
          <label>Belopp (kr)<input name="principal" inputMode="decimal" required /></label><label>Ränta (%)<input name="rate_pct" inputMode="decimal" required /></label></div>
        <div className="row"><label>Amortering<select name="type"><option value="straight">Rak (lika amortering)</option><option value="annuity">Annuitet (lika betalning)</option></select></label>
          <label>Löptid (månader)<input name="months" type="number" min={1} max={600} required /></label><label>Första betalning<input type="date" name="first_date" required /></label>
          <label>Lånekonto<input name="loan_account" type="number" defaultValue={2350} /></label><label>Utbetalt (bokförs)<input type="date" name="disbursed_on" /></label></div>
        <div><button>Lägg upp lånet</button></div>
        <p className="small muted" style={{ margin: 0 }}>Varje betalning bokförs automatiskt på förfallodagen: ränta på 8410 och amortering på lånekontot mot banken, och kopplas till uttaget i banken.</p>
      </form>

      <h2>Krediter</h2>
      {credits.length > 0 && <table className="small credits"><tbody>{credits.map((c) => <tr key={c.id}><td><b>{c.name}</b>{c.account && <div className="muted">{c.account}</div>}</td><td className="num">gräns {kr(c.credit_limit)}</td>
        <td className="num">utnyttjat {kr(c.used)} ({c.pct} %)</td><td className="num">kvar {kr(c.left)}</td></tr>)}</tbody></table>}
      <form action={credit.bind(null, id)} className="card row" style={{ alignItems: 'end' }}>
        <label>Kredit<input name="name" required placeholder="T.ex. Checkräkning" /></label><label>Bankkonto<select name="bank_account_id"><option value="">–</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Kreditgräns (kr)<input name="credit_limit" inputMode="decimal" required /></label><label>Ränta (%)<input name="rate_pct" inputMode="decimal" /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg till</button></div>
      </form>

      <h2>Sälj kundfakturor (factoring)</h2>
      {!factoringConfigured() ? <p className="muted">Ingen finansiär är kopplad.</p> : (<>
        <p className="small muted">Få betalt direkt: finansiären köper fakturan och betalar ut beloppet minus en avgift. Kunden betalar sedan till finansiären.</p>
        <div className="table-wrap"><table className="factoring"><thead><tr><th>Faktura</th><th>Kund</th><th>Förfaller</th><th className="num">Belopp</th><th>Status</th><th></th></tr></thead>
          <tbody>{fact.map((f) => <tr key={f.id} className="fact-row" data-invoice={f.number}><td><Link href={`/c/${id}/fakturor/${f.id}`}>{f.number}</Link></td><td>{f.customer}</td><td>{f.due}</td><td className="num">{kr(f.remaining)}</td>
            <td>{f.deal ? <><span className="badge">{DEAL[f.deal]}</span>{f.advance != null && <div className="small">utbetalning {kr(f.advance)}, avgift {kr(f.fee)}</div>}{f.message && <div className="small muted">{f.message}</div>}</> : ''}</td>
            <td>{(!f.deal || f.deal === 'rejected' || f.deal === 'cancelled') && <form action={offer.bind(null, id, f.id)}><button className="link">Begär erbjudande</button></form>}
              {f.deal === 'offered' && ctx.role === 'owner' && <form action={accept.bind(null, id, f.deal_id!)}><button>Sälj fakturan</button></form>}</td></tr>)}</tbody></table></div>
        {fact.some((f) => f.deal === 'accepted' || f.deal === 'offered') && <form action={refresh.bind(null, id)} className="actions"><button className="secondary">Hämta status från finansiären</button></form>}
      </>)}
    </div>
  );
}
