import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { addAccount, toggleAccount } from './actions';

export const dynamic = 'force-dynamic';

export default async function Accounts({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const rows = await sql<{ number: number; name: string; active: boolean; balance: number; used: boolean }[]>`
    SELECT a.number, a.name, a.active,
      COALESCE((SELECT SUM(l.debit - l.credit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
                WHERE v.company_id = a.company_id AND l.account_number = a.number), 0)::bigint AS balance
    FROM accounts a WHERE a.company_id = ${company.id} ORDER BY a.number`;
  return (
    <>
      <h1>Kontoplan</h1>
      <Flash searchParams={searchParams} />
      <form action={addAccount.bind(null, company.id)} className="card row">
        <label style={{ flex: '0 0 140px' }}>Konto<input name="number" inputMode="numeric" required /></label>
        <label style={{ flex: '3 1 300px' }}>Namn<input name="name" required /></label>
        <div style={{ flex: '0 0 auto' }}><button>Lägg till / byt namn</button></div>
      </form>
      <p className="muted small">Kontoplanen följer BAS. Lägg till de konton ni behöver. Ett konto som har använts kan inaktiveras men inte tas bort.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Konto</th><th>Namn</th><th className="num">Saldo totalt</th><th></th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.number} style={a.active ? undefined : { opacity: 0.5 }}>
                <td>{a.number}</td><td>{a.name}</td><td className="num">{a.balance ? kr(a.balance) : ''}</td>
                <td className="num"><form action={toggleAccount.bind(null, company.id, a.number)}><button className="link">{a.active ? 'Inaktivera' : 'Aktivera'}</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
