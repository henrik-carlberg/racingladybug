import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { kr } from '@/lib/format';
import { listTaxAccount } from '@/lib/services/taxaccount';
import { book, importFile, setStatus } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { new: 'Att bokföra', booked: 'Bokförd', bank: 'Via banken', ignored: 'Ignorerad' };

export default async function TaxAccount({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const { rows, reconciliation: r } = await listTaxAccount(company.id);
  const open = rows.filter((x) => x.status === 'new');
  const b = `/c/${company.id}`;
  return (
    <div>
      <h1>Skattekontot</h1>
      <p className="muted">Exportera transaktionerna från Skatteverkets e-tjänst Skattekonto (eller kopiera tabellen) och läs in dem här. Moms, arbetsgivaravgifter, avdragen skatt, F-skatt, räntor och avgifter föreslås konterade mot 1630. In- och utbetalningar stäms av via <Link href={`${b}/bank/avstamning`}>bankavstämningen</Link>.</p>
      {r && (
        <div className="card row" style={{ alignItems: 'center' }}>
          <span>Saldo {r.date}: Skatteverket <b>{kr(r.skatteverket)}</b> · bokfört på 1630 <b>{kr(r.ledger)}</b></span>
          <span className="tax-diff" style={{ color: r.diff === 0 ? 'var(--ok)' : 'var(--danger)' }}>{r.diff === 0 ? 'Stämmer ✓' : `Skillnad ${kr(r.diff)}`}</span>
        </div>
      )}
      <form action={importFile.bind(null, company.id)} className="card stack">
        <div className="row" style={{ alignItems: 'end' }}>
          <label style={{ flex: '2 1 260px' }}>Fil från Skatteverket (CSV)<input type="file" name="file" accept=".csv,.txt,text/csv" /></label>
          <div style={{ flex: '0 0 auto' }}><button className="secondary">Läs in</button></div>
        </div>
        <label>… eller klistra in transaktionerna (med rubrikraden)<textarea name="text" rows={3} placeholder={'Datum\tTransaktion\tBelopp\tSaldo'} /></label>
      </form>
      <form action={book.bind(null, company.id)}>
        <div className="table-wrap"><table>
          <thead><tr><th></th><th>Datum</th><th>Transaktion</th><th className="num">Belopp</th><th className="num">Saldo</th><th>Motkonto</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id}>
                <td>{x.status === 'new' && <input type="checkbox" name="id" value={x.id} defaultChecked={typeof x.suggestion === 'number'} />}</td>
                <td>{x.date}</td><td>{x.text}</td><td className="num">{kr(x.amount)}</td><td className="num">{x.balance != null ? kr(x.balance) : ''}</td>
                <td>{x.status === 'new' ? <input name={`account_${x.id}`} defaultValue={typeof x.suggestion === 'number' ? x.suggestion : ''} inputMode="numeric" style={{ width: '6rem' }} /> : x.voucher_id ? <Link href={`${b}/verifikationer/${x.voucher_id}`}>verifikation</Link> : ''}</td>
                <td className="small">{STATUS[x.status]}</td>
                <td className="small">{x.status === 'new' && <button className="link" formAction={setStatus.bind(null, company.id, x.id, 'ignored')}>Ignorera</button>}
                  {(x.status === 'ignored' || x.status === 'bank') && <button className="link" formAction={setStatus.bind(null, company.id, x.id, 'new')}>Ångra</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">Inga transaktioner inlästa.</td></tr>}
          </tbody>
        </table></div>
        {open.length > 0 && <div className="actions"><button>Bokför markerade</button><span className="small muted">En verifikation per rad: 1630 mot motkontot.</span></div>}
      </form>
    </div>
  );
}
