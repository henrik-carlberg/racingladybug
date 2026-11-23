import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { KINDS } from '@/lib/trade-finance';
import { overview } from '@/lib/services/trade-finance';
import { closeAction, createAction, docAction, feeAction } from './actions';

export const dynamic = 'force-dynamic';
const STATUS: Record<string, string> = { open: 'Gäller', utilized: 'Utnyttjad', closed: 'Avslutad', expired: 'Förfallen' };

export default async function TradeFinance({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  const t = today();
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Remburser och bankgarantier</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Remburser vid import och export med dokumentkrav, samt ställda och mottagna bankgarantier. En ställd garanti förs in som eventualförpliktelse och spärrade egna medel som ställd säkerhet i noten till årsredovisningen,
        och åtagandet upphör när rembursen eller garantin utnyttjas, avslutas eller förfaller. Bankavgifter bokförs mot 6570.</p>
      <div className="row">
        <div className="card stat"><div className="label">Ställda garantier</div><div className="value tf-guarantees">{kr(o.guaranteesGiven)}</div></div>
        <div className="card stat"><div className="label">Spärrade medel</div><div className="value tf-blocked">{kr(o.blocked)}</div></div>
        <div className="card stat"><div className="label">Går ut inom 30 dagar</div><div className="value tf-expiring">{o.expiring}</div></div>
      </div>
      <table className="tf-list"><thead><tr><th>Typ</th><th>Motpart</th><th className="num">Belopp</th><th>Giltig</th><th>Dokument</th><th className="num">Avgifter</th><th>Status</th><th></th></tr></thead>
        <tbody>{o.items.map((r) => (
          <tr key={r.id} className="tf-row" data-counterparty={r.counterparty} data-status={r.status}><td>{KINDS[r.kind]}{r.reference && <div className="small muted">{r.reference}</div>}{r.bank && <div className="small muted">{r.bank}</div>}</td><td>{r.counterparty}</td>
            <td className="num">{r.amount.toLocaleString('sv-SE', { minimumFractionDigits: 2 })} {r.currency}{r.currency !== 'SEK' && <div className="small muted">{kr(r.amount_sek)} kr</div>}{r.blocked > 0 && <div className="small muted">spärrat {kr(r.blocked)} kr</div>}</td>
            <td className="small">{r.issued_on}–{r.expires_on}{r.status === 'open' && r.daysLeft <= 30 && <div className="tf-soon" style={{ color: 'var(--danger)' }}>{r.daysLeft < 0 ? 'Har gått ut' : `${r.daysLeft} dagar kvar`}</div>}</td>
            <td className="small">{r.documents.map((d, i) => <form key={i} action={docAction.bind(null, id, r.id)} style={{ display: 'block' }}><input type="hidden" name="index" value={i} />
              <button className="link tf-doc" data-done={d.done ? '1' : '0'} disabled={r.status !== 'open'}>{d.done ? '☑' : '☐'} {d.name}</button></form>)}</td>
            <td className="num">{kr(r.fees)}</td>
            <td className="small">{STATUS[r.status]}{r.closed_on && ` ${r.closed_on}`}</td>
            <td>{r.status === 'open' && <div className="stack" style={{ gap: '.25rem' }}>
              <form action={feeAction.bind(null, id, r.id)} className="row" style={{ gap: '.25rem' }}><input name="amount" placeholder="Avgift" inputMode="decimal" style={{ width: '5rem' }} /><input type="hidden" name="date" value={t} /><button className="link">Bokför avgift</button></form>
              <form action={closeAction.bind(null, id, r.id, 'utilized')}><input type="hidden" name="date" value={t} /><button className="link">Utnyttjad</button></form>
              <form action={closeAction.bind(null, id, r.id, 'closed')}><input type="hidden" name="date" value={t} /><button className="link">Avsluta</button></form></div>}</td></tr>))}
          {!o.items.length && <tr><td colSpan={8} className="muted">Inga remburser eller garantier.</td></tr>}</tbody></table>
      <h2>Ny remburs eller garanti</h2>
      <form action={createAction.bind(null, id)} className="card stack">
        <div className="row">
          <label>Typ<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Motpart<input name="counterparty" required /></label>
          <label>Bank<input name="bank" /></label>
          <label>Referens<input name="reference" /></label>
        </div>
        <div className="row">
          <label>Belopp<input name="amount" inputMode="decimal" required style={{ width: '8rem' }} /></label>
          <label>Valuta<input name="currency" defaultValue="SEK" style={{ width: '4rem' }} /></label>
          <label>Motvärde i kr (valuta)<input name="amount_sek" inputMode="decimal" style={{ width: '8rem' }} /></label>
          <label>Spärrade egna medel (kr)<input name="blocked" inputMode="decimal" style={{ width: '8rem' }} /></label>
          <label>Utfärdad<input type="date" name="issued_on" defaultValue={t} /></label>
          <label>Giltig till<input type="date" name="expires_on" required /></label>
        </div>
        <label>Dokumentkrav (ett per rad, tomt = standard för remburser)<textarea name="documents" rows={2} /></label>
        <div><button>Registrera</button></div>
      </form>
    </div>
  );
}
