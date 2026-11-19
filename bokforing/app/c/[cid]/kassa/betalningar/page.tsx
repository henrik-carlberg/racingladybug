import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { listBankAccounts } from '@/lib/services/bank';
import { listProviders, listReports } from '@/lib/services/payproviders';
import { HAS_SALES, PROVIDER_LABEL } from '@/lib/payproviders';
import { connectProvider, syncNow, toggleProvider } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, [string, string]> = { booked: ['Bokförd', 'warn'], matched: ['Avstämd mot banken', 'ok'], error: ['Kontrollera', 'danger'], skipped: ['Ej bokförd', ''] };

export default async function Providers({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const b = `/c/${company.id}`;
  const [conns, reports, banks] = await Promise.all([listProviders(company.id), listReports(company.id), listBankAccounts(company.id)]);
  return (
    <div style={{ maxWidth: 1050 }}>
      <div className="header"><h1>Kortterminaler och utbetalningar</h1><Link className="btn secondary" href={`${b}/kassa`}>Kassa och e-handel</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">Dagsrapporter från Zettle och SumUp bokförs automatiskt varje natt: försäljning och moms per momssats mot avräkningskontot. Utbetalningar från kortterminaler, Stripe, Klarna och Shopify Payments delas upp i försäljning, returer och avgifter och stäms av mot insättningen på bankkontot.</p>

      {conns.length === 0 ? <EmptyState icon="bank" title="Inga kopplingar än">Koppla en kortterminal eller betalleverantör nedan.</EmptyState> : conns.map((c) => (
        <section key={c.id} className="card provider">
          <div className="header" style={{ marginBottom: '.3rem' }}>
            <div><b>{c.name}</b> <span className="muted small">{PROVIDER_LABEL[c.provider]} · avräkning {c.clearing_account} · avgifter {c.fee_account}{c.bank ? ` · ${c.bank}` : ''}{HAS_SALES[c.provider] ? ` · standardmoms ${c.default_vat} %` : ''}</span></div>
            <span className={`badge ${c.active ? (c.last_error ? 'danger' : 'ok') : ''}`}>{!c.active ? 'Pausad' : c.last_error ? 'Fel' : 'Aktiv'}</span>
          </div>
          <div className="small muted">{c.last_sync_at ? `Senast hämtad ${c.last_sync_at}, klar till och med ${c.synced_until}` : 'Inte hämtad än'} · {c.reports} rapporter</div>
          {c.last_error && <div className="small" style={{ color: 'var(--danger)' }}>{c.last_error}</div>}
          <div className="actions" style={{ margin: '.5rem 0 0' }}>
            {c.active && <form action={syncNow.bind(null, company.id, c.id)}><button>Hämta nu</button></form>}
            <form action={toggleProvider.bind(null, company.id, c.id, !c.active)}><button className="link">{c.active ? 'Pausa' : 'Aktivera'}</button></form>
          </div>
        </section>
      ))}

      {reports.length > 0 && (
        <>
          <h2>Rapporter och utbetalningar</h2>
          <table>
            <thead><tr><th>Datum</th><th>Källa</th><th>Typ</th><th className="num">Brutto</th><th className="num">Returer</th><th className="num">Avgifter</th><th className="num">Netto</th><th>Status</th></tr></thead>
            <tbody>{reports.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td><td>{r.name}</td><td>{r.kind === 'sales' ? 'Dagsrapport' : 'Utbetalning'}</td>
                <td className="num">{kr(r.gross)}</td><td className="num">{r.kind === 'payout' ? kr(r.refunds) : ''}</td><td className="num">{r.kind === 'payout' ? kr(r.fees) : ''}</td><td className="num">{kr(r.net)}</td>
                <td><span className={`badge ${ST[r.status][1]}`}>{ST[r.status][0]}</span>{r.voucher_id && <> <Link href={`${b}/verifikationer/${r.voucher_id}`}>verifikation</Link></>}{r.message && <div className="small muted">{r.message}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}

      <h2>Ny koppling</h2>
      <form action={connectProvider.bind(null, company.id)} className="card stack">
        <div className="row">
          <label>Leverantör<select name="provider" required defaultValue="">{[<option key="" value="" disabled>Välj…</option>, ...Object.entries(PROVIDER_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)]}</select></label>
          <label>Namn<input name="name" placeholder="T.ex. Butiken Storgatan" /></label>
        </div>
        <div className="row">
          <label style={{ flex: '2 1 280px' }}>API-nyckel / åtkomsttoken<input name="api_key" type="password" autoComplete="off" required /></label>
          <label>Klient-id (Zettle) / lösenord (Klarna)<input name="secret" type="password" autoComplete="off" /></label>
        </div>
        <div className="row">
          <label>Handlarkod (SumUp)<input name="merchant_code" /></label>
          <label>Butiksadress (Shopify)<input name="shop" placeholder="namn.myshopify.com" /></label>
        </div>
        <div className="row">
          <label>Avräkningskonto<input name="clearing_account" inputMode="numeric" defaultValue="1580" /></label>
          <label>Avgiftskonto<input name="fee_account" inputMode="numeric" defaultValue="6570" /></label>
          <label>Standardmoms (kortterminal)<select name="default_vat" defaultValue="25"><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option><option value="0">0 %</option></select></label>
          <label>Utbetalas till<select name="bank_account_id" defaultValue=""><option value="">1930 Företagskonto</option>{banks.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.ledger_account})</option>)}</select></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Nyckeln sparas krypterad och används bara för att läsa rapporter och utbetalningar. Använd en nyckel med endast läsbehörighet. Försäljning via Stripe, Klarna och Shopify ska bokföras mot samma avräkningskonto (fakturor eller e-handelskopplingen) så att utbetalningen nollar kontot.</p>
        <div><button>Spara koppling</button></div>
      </form>
    </div>
  );
}
