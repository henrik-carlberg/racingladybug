import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/client-funds';
import { clientAction, closeAction, entryAction, settingsAction } from './actions';

export const dynamic = 'force-dynamic';
const KIND: Record<string, string> = { deposit: 'Insättning', payout: 'Utbetalning', fee: 'Arvode' };

export default async function ClientFunds({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const clientId = Number(sp.client) || 0;
  const o = await overview(id, clientId || undefined);
  const c = o.clients.find((x) => x.id === clientId);
  const t = today();
  let run = 0;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Klientmedel</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Medel som du förvaltar åt klienter hålls på ett eget bankkonto ({o.settings.bank}) och redovisas som skuld till klienterna ({o.settings.liability}). Varje klient har ett eget saldo som aldrig får bli negativt.
        Arvoden tas ur klientens medel bara mot en faktura till klienten – beloppet förs över till bolagets konto och betalar fakturan.</p>
      <div className="row">
        <div className="card stat"><div className="label">Klienternas saldon</div><div className="value cf-total">{kr(o.total)}</div></div>
        <div className="card stat"><div className="label">Bank {o.settings.bank}</div><div className="value cf-bank">{kr(o.bank)}</div></div>
        <div className="card stat"><div className="label">Skuld {o.settings.liability}</div><div className="value cf-liability">{kr(o.liability)}</div></div>
        <div className="card stat"><div className="label">Avstämning</div><div className="value cf-check">{o.check.ok ? 'Stämmer' : `Differens bank ${kr(o.check.bankDiff)}, skuld ${kr(o.check.liabilityDiff)}`}</div></div>
      </div>
      <table className="cf-clients"><thead><tr><th>Klient</th><th>Ärende</th><th>Kund</th><th>Senast</th><th className="num">Saldo</th></tr></thead>
        <tbody>{o.clients.map((x) => <tr key={x.id} className="cf-row" data-name={x.name} style={x.closed ? { opacity: 0.5 } : undefined}><td><Link href={`/c/${id}/klientmedel?client=${x.id}`}>{x.name}</Link>{x.closed && ' (avslutad)'}</td><td>{x.reference}</td><td>{x.customer ?? ''}</td><td>{x.last ?? ''}</td><td className="num cf-balance">{kr(x.balance)}</td></tr>)}
          {!o.clients.length && <tr><td colSpan={5} className="muted">Inga klienter ännu.</td></tr>}</tbody></table>

      {c && <section className="card stack cf-statement">
        <h2 style={{ margin: 0 }}>Saldobesked: {c.name}{c.reference && ` – ${c.reference}`}</h2>
        <table><thead><tr><th>Datum</th><th>Händelse</th><th>Notering</th><th className="num">Belopp</th><th className="num">Saldo</th></tr></thead>
          <tbody>{o.entries.map((e) => { run += e.kind === 'deposit' ? e.amount : -e.amount; return <tr key={e.id}><td>{e.date}</td><td>{KIND[e.kind]}{e.invoice_number && ` (faktura ${e.invoice_number})`}</td><td className="small">{e.note}</td><td className="num">{kr(e.kind === 'deposit' ? e.amount : -e.amount)}</td><td className="num">{kr(run)}</td></tr>; })}
            {!o.entries.length && <tr><td colSpan={5} className="muted">Inga händelser.</td></tr>}</tbody>
          <tfoot><tr><th colSpan={4}>Saldo</th><th className="num cf-statement-balance">{kr(c.balance)}</th></tr></tfoot></table>
        {!c.closed && <form action={entryAction.bind(null, id, c.id)} className="row">
          <label>Händelse<select name="kind"><option value="deposit">Insättning</option><option value="payout">Utbetalning till klienten</option>{c.customer_id && <option value="fee">Arvode mot faktura</option>}</select></label>
          <label>Belopp<input name="amount" inputMode="decimal" style={{ width: '8rem' }} /></label>
          {o.invoices.length > 0 && <label>Faktura (arvode)<select name="invoice_id">{o.invoices.map((i) => <option key={i.id} value={i.id}>{i.number} ({kr(i.remaining)} kr)</option>)}</select></label>}
          <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
          <label>Notering<input name="note" /></label>
          <button>Bokför</button>
        </form>}
        {!c.closed && c.balance === 0 && <form action={closeAction.bind(null, id, c.id)}><button className="link">Avsluta klienten</button></form>}
      </section>}

      <h2>Ny klient</h2>
      <form action={clientAction.bind(null, id)} className="row">
        <label>Klient<input name="name" required /></label>
        <label>Ärende<input name="reference" placeholder="t.ex. bostadsförsäljning" /></label>
        <label>Kund (för arvodesfakturor)<select name="customer_id"><option value="">–</option>{o.customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <button>Lägg upp klient</button>
      </form>
      <details><summary className="small">Konton</summary>
        <form action={settingsAction.bind(null, id)} className="row">
          <label>Klientmedelskonto (bank)<input name="bank_account" defaultValue={o.settings.bank} style={{ width: '6rem' }} /></label>
          <label>Skuld till klienter<input name="liability_account" defaultValue={o.settings.liability} style={{ width: '6rem' }} /></label>
          <button className="secondary">Spara konton</button>
        </form></details>
    </div>
  );
}
