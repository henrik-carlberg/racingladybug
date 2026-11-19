import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { listBankAccounts } from '@/lib/services/bank';
import { cardAccounts, missingReceipts } from '@/lib/services/cards';
import { match, saveCard } from './actions';

export const dynamic = 'force-dynamic';

export default async function Cards({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id, b = `/c/${id}`;
  const sp = await searchParams;
  const mine = sp.mine === '1';
  const [cards, missing, accounts, members] = await Promise.all([
    cardAccounts(id), missingReceipts(id, mine ? { holderId: ctx.user.id } : {}), listBankAccounts(id),
    sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${id} ORDER BY u.name`,
  ]);
  const owner = ctx.role === 'owner';
  return (
    <>
      <div className="header"><h1>Företagskort</h1>
        {cards.length > 0 && <form action={match.bind(null, id)}><button className="secondary">Koppla kvitton till kortköp</button></form>}</div>
      <p className="muted">Kortköpen kommer från banken. Fota kvittot för varje köp – då bokförs kostnad och moms och köpet stäms av direkt.
        Kvitton som redan är bokförda kopplas automatiskt varje natt om belopp och datum stämmer.</p>
      <Flash searchParams={searchParams} />
      {cards.length === 0 ? (
        <div className="card">Inget bankkonto är markerat som företagskort ännu. {owner ? 'Markera kortkontot i listan Bankkonton längre ned.' : 'Be ägaren markera kortkontot.'}</div>
      ) : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>Kort</th><th>Kortinnehavare</th><th>Konto</th><th className="num">Saknar kvitto</th></tr></thead>
            <tbody>{cards.map((c) => (
              <tr key={c.id} className="card-row"><td>{c.name}</td><td>{c.holder ?? <span className="muted">Alla med bokföring</span>}</td><td>{c.ledger_account}</td>
                <td className="num">{c.missing ? <b>{c.missing} st · {kr(c.missing_amount)}</b> : <span className="badge ok">Alla kvitton finns</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <h2>Kortköp utan kvitto</h2>
          <p className="small">{mine ? <><b>Mina kort</b> · <Link href={`${b}/kort`}>Alla kort</Link></> : <><b>Alla kort</b> · <Link href={`${b}/kort?mine=1`}>Mina kort</Link></>}</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Datum</th><th>Köp</th><th>Kort</th><th className="num">Belopp</th><th></th></tr></thead>
            <tbody>{missing.map((t) => (
              <tr key={t.id} className="missing-tx"><td>{t.date}{t.age > 7 && <span className="badge warn" style={{ marginLeft: '.4rem' }}>{t.age} dagar</span>}</td><td>{t.text}</td>
                <td>{t.account}{t.holder ? ` (${t.holder})` : ''}</td><td className="num">{kr(-t.amount)}</td>
                <td className="num"><Link className="btn" href={`${b}/kvitto?tx=${t.id}`}>📷 Fota kvitto</Link></td></tr>
            ))}{missing.length === 0 && <tr><td colSpan={5} className="muted">Alla kortköp har kvitto.</td></tr>}</tbody>
          </table></div>
          <p className="small muted">Köp som inte ska ha kvitto (t.ex. överföringar) bokför du under <Link href={`${b}/bank/avstamning`}>Bankavstämning</Link>.
            Kortinnehavaren får en pushnotis två dagar efter köpet om kvittot saknas.</p>
        </>
      )}
      {owner && (
        <>
          <h2>Bankkonton</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Konto</th><th>Företagskort</th><th>Kortinnehavare</th><th></th></tr></thead>
            <tbody>{accounts.map((a) => {
              const c = cards.find((x) => x.id === a.id);
              return (
                <tr key={a.id}><td>{a.name} <span className="small muted">({a.ledger_account})</span></td>
                  <td colSpan={3}><form action={saveCard.bind(null, id, a.id)} className="row" style={{ alignItems: 'center' }}>
                    <label style={{ flex: '0 0 auto' }}><input type="checkbox" name="is_card" defaultChecked={!!c} aria-label={`${a.name} är ett företagskort`} /> Kort</label>
                    <select name="holder" defaultValue={c?.holder_id ?? ''} aria-label="Kortinnehavare"><option value="">Ingen särskild</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                    <button className="secondary">Spara</button></form></td></tr>
              );
            })}{accounts.length === 0 && <tr><td colSpan={4} className="muted">Lägg först upp kortkontot under <Link href={`${b}/bank`}>Bank</Link>.</td></tr>}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
