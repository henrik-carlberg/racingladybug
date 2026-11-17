import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { enableBankingConfigured, listAspsps } from '@/lib/bank/enablebanking';
import { listBankAccounts } from '@/lib/services/bank';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { addManualAccount, connectBank, disconnectBank, importStatement, setLedger, sync } from './actions';

export const dynamic = 'force-dynamic';

const CONN: Record<string, [string, string]> = {
  active: ['Kopplad', 'ok'], expired: ['Samtycket har gått ut', 'danger'], revoked: ['Bortkopplad', ''], error: ['Fel', 'danger'], pending: ['Påbörjad', ''],
};

export default async function Bank({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid);
  const accounts = await listBankAccounts(company.id);
  const ledger = new Map((await sql<{ account_number: number; b: number }[]>`
    SELECT l.account_number, SUM(l.debit - l.credit)::bigint AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${company.id} AND l.account_number BETWEEN 1900 AND 1999 GROUP BY 1`).map((r) => [r.account_number, r.b]));
  const connections = await sql<{ id: number; aspsp_name: string; status: string; valid_until: string | null; last_error: string | null }[]>`
    SELECT id, aspsp_name, status, to_char(valid_until,'YYYY-MM-DD') AS valid_until, last_error FROM bank_connections
    WHERE company_id = ${company.id} AND status <> 'pending' ORDER BY id DESC`;
  const configured = enableBankingConfigured();
  const banks = configured && role === 'owner' ? await listAspsps('SE').catch(() => []) : [];
  const b = `/c/${company.id}`;
  return (
    <>
      <div className="header"><h1>Bank</h1><Link className="btn" href={`${b}/bank/avstamning`}>Bankavstämning</Link></div>
      <Flash searchParams={searchParams} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Konto</th><th>Källa</th><th className="num">Saldo i banken</th><th className="num">Saldo i bokföringen</th><th className="num">Ej avstämt</th><th></th></tr></thead>
          <tbody>
            {accounts.map((a) => {
              const booked = ledger.get(a.ledger_account) ?? 0;
              const diff = a.balance != null ? a.balance - booked : null;
              return (
                <tr key={a.id}>
                  <td><b>{a.name}</b><div className="small muted mono">{a.iban}</div>
                    <form action={setLedger.bind(null, company.id, a.id)} className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      Bokförs på <input name="ledger_account" defaultValue={a.ledger_account} style={{ width: 70, padding: '2px 4px' }} /> <button className="link">Spara</button>
                    </form></td>
                  <td className="small">{a.source === 'open_banking' ? <>{a.bank} <span className={`badge ${CONN[a.connection_status ?? '']?.[1] ?? ''}`}>{CONN[a.connection_status ?? '']?.[0] ?? a.connection_status}</span>
                    {a.last_synced_at && <div className="muted">Hämtad {new Date(a.last_synced_at).toLocaleString('sv-SE')}</div>}</> : 'Filimport'}</td>
                  <td className="num">{a.balance != null ? <>{kr(a.balance)}<div className="small muted">{a.balance_date}</div></> : '–'}</td>
                  <td className="num">{kr(booked)}{diff != null && diff !== 0 && <div className="small" style={{ color: 'var(--warn)' }}>diff {kr(diff)}</div>}</td>
                  <td className="num">{a.unmatched ? <Link href={`${b}/bank/avstamning?account_id=${a.id}`}>{a.unmatched}</Link> : '0'}</td>
                  <td>
                    <div className="stack" style={{ gap: 6 }}>
                      {a.source === 'open_banking' && a.connection_status === 'active' && <form action={sync.bind(null, company.id, a.id)}><button className="secondary">Hämta transaktioner</button></form>}
                      <form action={importStatement.bind(null, company.id, a.id)} style={{ display: 'flex', gap: 4 }}>
                        <input type="file" name="file" accept=".xml,.csv,.txt" required style={{ maxWidth: 200 }} /><button className="secondary">Importera</button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && <tr><td colSpan={6} className="muted">Inga bankkonton ännu.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">Saldot i banken jämförs med bokföringens saldo på kontot. En skillnad betyder oftast att transaktioner inte är avstämda ännu.</p>

      <h2>Koppla bank (Open Banking)</h2>
      {!configured ? (
        <p className="muted">Open Banking är inte aktiverat. Registrera appen hos Enable Banking och sätt <span className="mono">ENABLEBANKING_APP_ID</span> och <span className="mono">ENABLEBANKING_PRIVATE_KEY</span> (se README). Under tiden kan du importera kontoutdrag som fil.</p>
      ) : role !== 'owner' ? (
        <p className="muted">Endast bolagets ägare kan koppla banken (kräver BankID och fullmakt för företagets konton).</p>
      ) : (
        <form action={connectBank.bind(null, company.id)} className="card row">
          <label style={{ flex: '2 1 260px' }}>Bank
            <select name="aspsp" required>{banks.map((x) => <option key={x.name} value={x.name}>{x.name}{x.beta ? ' (beta)' : ''}</option>)}</select>
          </label>
          <label>Kontotyp<select name="psu_type"><option value="business">Företag</option><option value="personal">Privat (enskild firma)</option></select></label>
          <div style={{ flex: '0 0 auto' }}><button>Koppla med BankID</button></div>
        </form>
      )}
      <p className="small muted">Kopplingen ger appen läsbehörighet till konton, saldon och transaktioner. Inga betalningar kan göras. Samtycket gäller normalt 90–180 dagar och förnyas sedan med BankID.
        För företagskonton kan banken kräva att du har fullmakt för öppna bank-tjänster (t.ex. Handelsbanken).</p>
      {connections.length > 0 && (
        <table>
          <thead><tr><th>Bank</th><th>Status</th><th>Samtycke till</th><th></th></tr></thead>
          <tbody>{connections.map((c) => (
            <tr key={c.id}><td>{c.aspsp_name}</td><td>{CONN[c.status]?.[0] ?? c.status}{c.last_error && <div className="small muted">{c.last_error}</div>}</td><td>{c.valid_until ?? ''}</td>
              <td className="num">{role === 'owner' && c.status === 'active' && <form action={disconnectBank.bind(null, company.id, c.id)}><button className="link">Koppla bort</button></form>}</td></tr>
          ))}</tbody>
        </table>
      )}

      <h2>Konto för filimport</h2>
      <form action={addManualAccount.bind(null, company.id)} className="card row">
        <label>Namn<input name="name" required placeholder="Företagskonto" /></label>
        <label>Kontonummer/IBAN<input name="iban" /></label>
        <label style={{ flex: '0 0 140px' }}>Bokföringskonto<input name="ledger_account" defaultValue="1930" /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg till</button></div>
      </form>
      <p className="small muted">Importera kontoutdrag från internetbanken som <b>camt.053 (ISO 20022 XML)</b> eller <b>CSV</b> (SEB, Swedbank, Handelsbanken, Nordea m.fl.). Transaktioner som redan finns hoppas över.</p>
    </>
  );
}
