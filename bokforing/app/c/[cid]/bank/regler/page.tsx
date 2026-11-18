import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { BankRuleFields } from '@/components/BankRuleFields';
import { listRules, openMatches } from '@/lib/services/bank-rules';
import { create, remove, starters, update } from './actions';

export const dynamic = 'force-dynamic';

export default async function Rules({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const rules = await openMatches(company.id, await listRules(company.id));
  const chart = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  const names = new Map(chart.map((a) => [a.number, a.name]));
  const b = `/c/${company.id}/bank`;
  const p = (k: string) => (typeof sp[k] === 'string' ? String(sp[k]) : undefined);
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Konteringsregler för banken</h1><Link className="btn secondary" href={`${b}/avstamning`}>Bankavstämning</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">Regler föreslår konto och moms för banktransaktioner, t.ex. att allt från Telia bokförs på 6212 med 25 % moms. Inbetalningar som kan vara en kundfaktura och betalningar av leverantörsfakturor matchas alltid först.
        Även utan regler föreslås konton när samma motpart har bokförts likadant minst två gånger.</p>
      <datalist id="chart">{chart.map((a) => <option key={a.number} value={a.number}>{a.name}</option>)}</datalist>

      <h2>Ny regel</h2>
      <form action={create.bind(null, company.id)} className="card stack">
        <input type="hidden" name="back" value={p('back') ?? ''} />
        <BankRuleFields prefill={{ pattern: p('pattern'), account: p('account'), vat: p('vat'), direction: p('direction'), description: p('description') }} />
        <div><button>Spara regel</button></div>
      </form>

      <div className="header"><h2>Regler ({rules.length})</h2>
        <form action={starters.bind(null, company.id)}><button className="secondary">Lägg till vanliga regler</button></form></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Regel</th><th>Sökord</th><th>Kontering</th><th className="num">Använd</th><th className="num">Öppna träffar</th><th></th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} id={`r${r.id}`}>
              <td><b>{r.name}</b> {r.auto && <span className="badge ok">Automatisk</span>}
                <div className="small muted">{r.direction === 'out' ? 'Uttag' : r.direction === 'in' ? 'Insättning' : 'In och ut'}{r.amountMin != null || r.amountMax != null ? ` · ${r.amountMin != null ? kr(r.amountMin) : '0'}–${r.amountMax != null ? kr(r.amountMax) : '∞'} kr` : ''}</div></td>
              <td><code>{r.pattern}</code></td>
              <td>{r.account} {names.get(r.account)}{r.vatRate ? ` · ${r.vatRate} % moms` : ''}</td>
              <td className="num">{r.hits}{r.last_used_at && <div className="small muted">{r.last_used_at}</div>}</td>
              <td className="num">{r.open_matches ? <Link href={`${b}/avstamning`}>{r.open_matches}</Link> : 0}</td>
              <td className="num">
                <details><summary className="small">Ändra</summary>
                  <form action={update.bind(null, company.id, r.id)} className="stack" style={{ minWidth: 520, textAlign: 'left' }}><BankRuleFields r={r} /><div><button className="secondary">Spara</button></div></form>
                  <form action={remove.bind(null, company.id, r.id)}><button className="link small">Ta bort regeln</button></form>
                </details>
              </td>
            </tr>
          ))}
          {rules.length === 0 && <tr><td colSpan={6} className="muted">Inga regler ännu.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
