import { Help } from '@/components/Help';
import { commentCounts } from '@/lib/services/comments';
import { ask } from '../../fragor/actions';
import Link from 'next/link';
import { UndoButton } from '@/components/Undo';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { listBankAccounts, listTransactions } from '@/lib/services/bank';
import { Flash, type SP, EmptyState } from '@/components/ui';
import { kr } from '@/lib/format';
import { aiSuggest, autoMatch, bookAllSuggestions, ignoreTxNow, reconcileTx, reopenTx } from '../actions';
import { aiEnabled, type AiBankSuggestion } from '@/lib/services/ai-bookkeeping';
import { learnKey } from '@/lib/bank/rules';
import { listCostCenters, listProjectRefs } from '@/lib/services/dimensions';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = { invoice: 'Kundfaktura', supplier_invoice: 'Leverantörsfaktura', voucher: 'Befintlig verifikation', account: 'Bokförd', ignore: 'Ignorerad' };

export default async function Reconcile({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid, { perm: 'ledger' });
  const sp = await searchParams;
  const status = String(sp.status ?? 'unmatched');
  const accountId = sp.account_id ? Number(sp.account_id) : undefined;
  const accounts = await listBankAccounts(company.id);
  const rows = await listTransactions(company.id, { status, account_id: accountId, limit: 300, withSuggestions: status === 'unmatched' });
  const [ccs, projs] = await Promise.all([listCostCenters(company.id, true), listProjectRefs(company.id, true)]);
  const accNames = new Map(accounts.map((a) => [a.id, a.name]));
  const chart = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  const b = `/c/${company.id}`;
  const ids = rows.map((r) => r.id);
  const comments = await commentCounts(company.id, 'bank_transaction', ids);
  const docs = new Map((ids.length ? await sql<{ id: number; requested: boolean; attachment: number | null }[]>`
    SELECT q.entity_id AS id, bool_or(q.status = 'open' AND q.needs_document) AS requested, max(a.id) AS attachment
    FROM client_questions q LEFT JOIN attachments a ON a.question_id = q.id
    WHERE q.company_id = ${company.id} AND q.entity = 'bank_transaction' AND q.entity_id IN ${sql(ids)} GROUP BY q.entity_id` : []).map((r) => [r.id, r]));
  const aiMap = new Map((ids.length ? await sql<{ id: number; s: AiBankSuggestion }[]>`SELECT id, ai_suggestion AS s FROM bank_transactions WHERE company_id = ${company.id} AND id IN ${sql(ids)} AND ai_suggestion IS NOT NULL` : []).map((r) => [r.id, r.s]));
  const unknown = rows.filter((r) => r.status === 'unmatched' && !(r.suggestions ?? []).length && !r.accountSuggestion && !aiMap.has(r.id)).map((r) => r.id);
  const ai = aiEnabled();
  const withAccount = rows.filter((r) => r.accountSuggestion && !(r.suggestions ?? []).some((x) => x.score >= 80)).length;
  const ruleLink = (t: (typeof rows)[number], account?: number | null) => `${b}/bank/regler?${new URLSearchParams({ pattern: learnKey(t), direction: t.amount < 0 ? 'out' : 'in',
    ...(account ? { account: String(account) } : {}), description: t.counterparty || t.description, back: `${b}/bank/avstamning` }).toString()}`;
  const qs = new URLSearchParams(Object.entries({ status, account_id: accountId ? String(accountId) : '' }).filter(([, v]) => v)).toString();
  return (
    <>
      <div className="header">
        <h1>Bankavstämning <Help term="avstamning" /></h1>
        <div className="actions" style={{ margin: 0 }}>
          {status === 'unmatched' && <form action={autoMatch.bind(null, company.id)}><button>Stäm av säkra matchningar automatiskt</button></form>}
          {withAccount > 0 && <form action={bookAllSuggestions.bind(null, company.id)}><button className="secondary">Bokför alla kontoförslag ({withAccount})</button></form>}
          <Link className="btn secondary" href={`${b}/bank/regler`}>Konteringsregler</Link>
          <Link className="btn secondary" href={`${b}/bank`}>Bankkonton</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="actions">
        {[['unmatched', 'Att stämma av'], ['matched', 'Avstämda'], ['ignored', 'Ignorerade']].map(([s, l]) => (
          <Link key={s} className={`btn ${status === s ? '' : 'secondary'}`} href={`${b}/bank/avstamning?status=${s}${accountId ? `&account_id=${accountId}` : ''}`}>{l}</Link>
        ))}
      </div>
      {ai && unknown.length > 1 && <form action={aiSuggest.bind(null, company.id, unknown.slice(0, 20))} className="card row" style={{ alignItems: 'center' }}><span style={{ flex: 1 }}>{unknown.length} transaktioner känns inte igen av regler eller tidigare konteringar.</span><button className="secondary">✨ Föreslå konton med AI{unknown.length > 20 ? ' (20 första)' : ''}</button></form>}
      <datalist id="chart">{chart.map((a) => <option key={a.number} value={a.number}>{a.name}</option>)}</datalist>
      {rows.length === 0 && (status === 'unmatched'
        ? <EmptyState icon="check" title="Allt är avstämt" actions={[{ href: `${b}/bank`, label: 'Hämta nya transaktioner', secondary: true }]}>Det finns inga banktransaktioner som väntar. Nya transaktioner hämtas från banken automatiskt varje natt om banken är kopplad.</EmptyState>
        : <p className="muted">Inga transaktioner.</p>)}
      {rows.map((t) => (
        <div key={t.id} className="card" id={`t${t.id}`} data-undo-row>
          <div className="header" style={{ marginBottom: '.5rem' }}>
            <div>
              <b>{t.booking_date}</b> · {t.counterparty || t.description || 'Transaktion'}
              {docs.get(t.id)?.requested && <> <span className="badge warn">Underlag begärt</span></>}
              {docs.get(t.id)?.attachment && <> <a className="badge ok" href={`${b}/underlag/${docs.get(t.id)!.attachment}`}>📎 Underlag inskickat</a></>}
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
              {aiMap.get(t.id) && !t.accountSuggestion && (() => { const a = aiMap.get(t.id)!; return (
                <form action={reconcileTx.bind(null, company.id, t.id)} className="row" style={{ alignItems: 'center' }}>
                  <input type="hidden" name="type" value="account" /><input type="hidden" name="qs" value={qs} />
                  <input type="hidden" name="account" value={a.account} /><input type="hidden" name="vat_rate" value={a.vatRate} /><input type="hidden" name="description" value={a.description} />
                  <span style={{ flex: '3 1 300px' }}><span className="badge">✨ AI</span> {a.account} {a.accountName}{a.vatRate ? `, ${a.vatRate} % moms` : ''} <span className="small muted">– {a.reason}</span></span>
                  <div style={{ flex: '0 0 auto' }}><button className="secondary">Bokför</button></div>
                </form>); })()}
              {ai && unknown.includes(t.id) && <form action={aiSuggest.bind(null, company.id, [t.id])}><button className="link small">✨ Föreslå konto med AI</button></form>}
              {t.accountSuggestion && (() => { const a = t.accountSuggestion; return (
                <form action={reconcileTx.bind(null, company.id, t.id)} className="row" style={{ alignItems: 'center' }}>
                  <input type="hidden" name="type" value="account" /><input type="hidden" name="qs" value={qs} />
                  <input type="hidden" name="account" value={a.account} /><input type="hidden" name="vat_rate" value={a.vatRate} /><input type="hidden" name="description" value={a.description} />
                  {a.ruleId && <input type="hidden" name="rule_id" value={a.ruleId} />}
                  {a.costCenterId && <input type="hidden" name="cost_center_id" value={a.costCenterId} />}
                  <span style={{ flex: '3 1 300px' }}><span className="badge ok">Konto</span> {a.account} {a.accountName}{a.vatRate ? `, ${a.vatRate} % moms` : ''}
                    <span className="small muted"> – {a.source === 'rule' ? `regel ”${a.ruleName}”${a.auto ? ' (automatisk)' : ''}` : `bokförd så ${a.count} gånger tidigare`}</span></span>
                  <div style={{ flex: '0 0 auto' }}><button className={(t.suggestions ?? []).some((x) => x.score >= 80) ? 'secondary' : ''}>Bokför</button></div>
                </form>); })()}
              <details>
                <summary className="small">Bokför mot konto</summary>
                <form action={reconcileTx.bind(null, company.id, t.id)} className="row" style={{ marginTop: '.5rem' }}>
                  <input type="hidden" name="type" value="account" /><input type="hidden" name="qs" value={qs} />
                  <label style={{ flex: '0 0 130px' }}>Konto<input name="account" list="chart" required defaultValue={t.accountSuggestion?.account} placeholder={t.amount < 0 ? '6570' : '3001'} /></label>
                  <label style={{ flex: '0 0 110px' }}>Moms<select name="vat_rate" defaultValue="0"><option value="0">Ingen</option><option value="25">25 %</option><option value="12">12 %</option><option value="6">6 %</option></select></label>
                  <label style={{ flex: '2 1 200px' }}>Text<input name="description" defaultValue={t.counterparty || t.description} /></label>
                  {ccs.length > 0 && <label style={{ flex: '0 0 150px' }}>Kostnadsställe<select name="cost_center_id" defaultValue=""><option value="">–</option>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>}
                  {projs.length > 0 && <label style={{ flex: '0 0 150px' }}>Projekt<select name="project_id" defaultValue=""><option value="">–</option>{projs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
                  <div style={{ flex: '0 0 auto' }}><button className="secondary">Bokför</button></div>
                </form>
              </details>
              <div className="row small" style={{ gap: '1rem', alignItems: 'center' }}>
                <Link href={`${b}/fragor?entity=bank_transaction&id=${t.id}`}>Fråga {role === 'accountant' ? 'kunden' : 'byrån'} om transaktionen</Link>
                {!docs.get(t.id)?.requested && !docs.get(t.id)?.attachment && (
                  <form action={ask.bind(null, company.id)} style={{ display: 'inline' }}>
                    <input type="hidden" name="entity" value="bank_transaction" /><input type="hidden" name="entity_id" value={t.id} /><input type="hidden" name="needs_document" value="1" />
                    <input type="hidden" name="question" value={`Underlag saknas: ${t.booking_date} ${t.counterparty || t.description} ${(t.amount / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr. Fota kvittot eller ladda upp fakturan.`} />
                    <input type="hidden" name="back" value={`${b}/bank/avstamning${qs ? `?${qs}` : ''}#t${t.id}`} />
                    <button className="link small">Begär underlag</button>
                  </form>
                )}
                <Link href={`${b}/kommentarer?entity=bank_transaction&id=${t.id}`}>Kommentarer{comments[t.id] ? ` (${comments[t.id]})` : ''}</Link>
              </div>
              <div><UndoButton action={ignoreTxNow.bind(null, company.id, t.id)} message="Transaktionen ignoreras" className="link small">Ignorera (bokförs inte, t.ex. överföring mellan egna konton som redan är bokförd)</UndoButton></div>
            </div>
          ) : (
            <div className="small">
              {TYPE_LABEL[t.match_type ?? ''] ?? t.match_type}
              {t.voucher_id && <> – <Link href={`${b}/verifikationer/${t.voucher_id}`}>verifikation</Link></>}
              {t.match_type === 'invoice' && t.match_id && <> – <Link href={`${b}/fakturor/${t.match_id}`}>faktura</Link></>}
              {t.match_type === 'supplier_invoice' && t.match_id && <> – <Link href={`${b}/leverantorsfakturor/${t.match_id}`}>leverantörsfaktura</Link></>}
              {t.match_type === 'account' && !t.rule_id && <> · <Link href={ruleLink(t, t.booked_account)}>Skapa regel så att {t.counterparty || 'motparten'} bokförs så automatiskt</Link></>}
              {(t.status === 'ignored' || t.match_type === 'voucher') && <form action={reopenTx.bind(null, company.id, t.id)} style={{ display: 'inline', marginLeft: 8 }}><button className="link">Ångra</button></form>}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
