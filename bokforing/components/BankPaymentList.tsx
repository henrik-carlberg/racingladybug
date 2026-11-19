import { kr } from '@/lib/format';

const ST: Record<string, [string, string]> = { authorization: ['Väntar på godkännande i banken', 'warn'], accepted: ['Godkänd – genomförs', 'warn'], executed: ['Genomförd och bokförd', 'ok'], rejected: ['Avbruten/avvisad', 'danger'], failed: ['Kunde inte skickas', 'danger'] };

export function BankPaymentList({ payments, refresh }: { payments: { id: number; status: string; message: string; date: string; total: number; items: number; created: string; by: string | null }[]; refresh: () => Promise<void> }) {
  return (
    <section className="bank-payments">
      <h2>Betalningar via banken</h2>
      <table>
        <thead><tr><th>Skapad</th><th>Betaldag</th><th>Antal</th><th className="num">Belopp</th><th>Status</th></tr></thead>
        <tbody>{payments.map((p) => (
          <tr key={p.id}><td>{p.created}{p.by && <div className="small muted">{p.by}</div>}</td><td>{p.date}</td><td>{p.items}</td><td className="num">{kr(p.total)}</td>
            <td><span className={`badge ${ST[p.status][1]}`}>{ST[p.status][0]}</span>{p.message && <div className="small muted">{p.message}</div>}</td></tr>
        ))}</tbody>
      </table>
      {payments.some((p) => p.status === 'authorization' || p.status === 'accepted') && <form action={refresh} className="actions"><button className="secondary">Hämta status från banken</button></form>}
    </section>
  );
}
