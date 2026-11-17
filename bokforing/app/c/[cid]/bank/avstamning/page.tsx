import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { listBankAccounts, listTransactions } from '@/lib/services/bank';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { autoMatch, reconcileTx, reopenTx } from '../actions';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = { invoice: 'Kundfaktura', supplier_invoice: 'Leverantörsfaktura', voucher: 'Befintlig verifikation', account: 'Bokförd', ignore: 'Ignorerad' };

export default async function Reconcile({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const status = String(sp.status ?? 'unmatched');
  const accountId = sp.account_id ? Number(sp.account_id) : undefined;
  const accounts = await listBankAccounts(company.id);
  const rows = await listTransactions(company.id, { status, account_id: accountId, limit: 300, withSuggestions: status === 'unmatched' });
  const accNames = new Map(accounts.map((a) => [a.id, a.name]));
  const chart = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  const b = `/c/${company.id}`;
  const qs = new URLSearchParams(Object.entries({ status, account_id: accountId ? String(accountId) : '' }).filter(([, v]) => v)).toString();
  return (
    <>
      <div className="header">
        <h1>Bankavstämning</h1>
        <div className="actions" style={{ margin: 0 }}>
          {status === 'unmatched' && <form action={autoMatch.bind(null, company.id)}><button>Stäm av säkra matchningar automatiskt</button></form>}
          <Link className="btn secondary" href={`${b}/bank`}>Bankkonton</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="actions">
        {[['unmatched', 'Att stämma av'], ['matched', 'Avstämda'], ['ignored', 'Ignorerade']].map(([s, l]) => (
          <Link key={s} className={`btn ${status === s ? '' : 'secondary'}`} href={`${b}/bank/avstamning?status=${s}${accountId ? `&account_id=${accountId}` : ''}`}>{l}</Link>
        ))}
      </div>
      <datalist id="chart">{chart.map((a) => <option key={a.number} value={a.number}>{a.name}</option>)}</datalist>
      {rows.length === 0 && <p className="muted">Inga transaktioner.</p>}
      {rows.map((t) => (
        <div key={t.id} className="card" id={`t${t.id}`}>
          <div className="header" style={{ marginBottom: '.5rem' }}>
            <div>
              <b>{t.booking_date}</b> · {t.counterparty || t.description || 'Transaktion'}
              <div className="small muted">{[t.description !== t.counterparty ? t.description : '', t.reference && `Ref: ${t.reference}`, accNames.get(t.bank_account_id)].filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 600, color: t.amount < 0 ? 'var(--danger)' : 'var(--ok)' }}>{kr(t.amount)}</div>
          </div>
          {t.status === 'unmatched' ? (
            <div className="stack">
              {(t.suggestions ?? []).map((s) => (
                <form key={`${s.type}${s.id}`} action={reconcileTx.bind(null, company.id, t.id)} className="row" style={{ alignItems: 'center' }}>
                  <input type="hidden" name="type" value={s.type} /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="qs" value={qs} />
                  <span style={{ flex: '3 1 300px' }}><span className={`badge ${s.score >= 90 ? 'ok' : 'warn'}`}>{s.score} %</span> {s.label} <span className="small muted">– {s.reason}</span></span>
                  <div style={{ flex: '0 0 auto' }}><button className={s.score >= 90 ? '' : 'secondary'}>{s.type === 'voucher' ? 'Koppla' : 'Matcha och bokför'}</button></div>
                </form>
              ))}
              <details>
                <summary className="small">Bokför mot konto</summary>
                <form action={reconcileTx.bind(null, company.id, t.id)} className="row" style={{ marginTop: '.5rem' }}>
                  <input type="hidden" name="type" value="account" /><input type="hidden" name="qs" value={qs} />
                  <label style={{ flex: '0 0 130px' }}>Konto<input name="account" list="chart" required placeholder={t.amount < 0 ? '6570' : '3001'} /></label>
                  <label style={{ flex: '0 0 110px' }}>Moms<select name="vat_rate" defaultValue="0"><option value="0">Ingen</option><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option></select></label>
                  <label style={{ flex: '2 1 200px' }}>Text<input name="description" defaultValue={t.counterparty || t.description} /></label>
                  <div style={{ flex: '0 0 auto' }}><button className="secondary">Bokför</button></div>
                </form>
              </details>
              <form action={reconcileTx.bind(null, company.id, t.id)}>
                <input type="hidden" name="type" value="ignore" /><input type="hidden" name="qs" value={qs} />
                <button className="link small">Ignorera (bokförs inte, t.ex. överföring mellan egna konton som redan är bokförd)</button>
              </form>
            </div>
          ) : (
            <div className="small">
              {TYPE_LABEL[t.match_type ?? ''] ?? t.match_type}
              {t.voucher_id && <> – <Link href={`${b}/verifikationer/${t.voucher_id}`}>verifikation</Link></>}
              {t.match_type === 'invoice' && t.match_id && <> – <Link href={`${b}/fakturor/${t.match_id}`}>faktura</Link></>}
              {t.match_type === 'supplier_invoice' && t.match_id && <> – <Link href={`${b}/leverantorsfakturor/${t.match_id}`}>leverantörsfaktura</Link></>}
              {(t.status === 'ignored' || t.match_type === 'voucher') && <form action={reopenTx.bind(null, company.id, t.id)} style={{ display: 'inline', marginLeft: 8 }}><button className="link">Ångra</button></form>}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
