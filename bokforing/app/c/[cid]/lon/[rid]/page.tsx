import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { PAY_ITEM_LABELS, type PayItem } from '@/lib/payroll';
import { addEmployee, bookRun, deleteRun, removeSlip, saveSlip, applyAbsence } from '../actions';

export const dynamic = 'force-dynamic';

interface Slip {
  id: number; employee_id: number; name: string; items: PayItem[]; gross_cash: number; benefits: number; tax: number;
  net_deductions: number; reimbursements: number; net_pay: number; employer_fee: number; employer_fee_rate: string; pension: number; pension_tax: number;
  tax_info: string;
}

const fmt = (o: number) => (o / 100).toFixed(2).replace('.', ',');

export default async function Run({ params, searchParams }: { params: Promise<{ cid: string; rid: string }>; searchParams: SP }) {
  const { cid, rid } = await params;
  const { company } = await requireCompany(cid);
  const [run] = await sql<{ id: number; period: string; payment_date: string; status: string; voucher_id: number | null; booked_by: string | null }[]>`
    SELECT r.id, r.period, to_char(r.payment_date,'YYYY-MM-DD') AS payment_date, r.status, r.voucher_id, u.name AS booked_by
    FROM payroll_runs r LEFT JOIN users u ON u.id = r.booked_by WHERE r.id = ${Number(rid)} AND r.company_id = ${company.id}`;
  if (!run) notFound();
  const slips = await sql<Slip[]>`
    SELECT p.*, e.first_name || ' ' || e.last_name AS name,
      CASE WHEN e.tax_mode = 'table' THEN 'Tabell ' || e.tax_table || ', kolumn ' || e.tax_column ELSE e.tax_percent || ' %' END AS tax_info
    FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ${run.id} ORDER BY e.last_name`;
  const others = await sql<{ id: number; name: string }[]>`
    SELECT id, first_name || ' ' || last_name AS name FROM employees e WHERE company_id = ${company.id} AND active
      AND NOT EXISTS (SELECT 1 FROM payslips p WHERE p.run_id = ${run.id} AND p.employee_id = e.id) ORDER BY last_name`;
  const sum = (k: keyof Slip) => slips.reduce((s, p) => s + (p[k] as number), 0);
  const draft = run.status === 'draft';
  const b = `/c/${company.id}`;
  return (
    <>
      <div className="header">
        <h1>Lön {run.period} <span className={`badge ${draft ? '' : 'ok'}`}>{draft ? 'Utkast' : 'Bokförd'}</span></h1>
        <div className="actions" style={{ margin: 0 }}>
          {!draft && <a className="btn" href={`${b}/lon/${run.id}/agi`}>Ladda ner AGI-fil</a>}
          <Link className="btn secondary" href={`${b}/lon`}>Tillbaka</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Utbetalningsdag</div><div className="value">{run.payment_date}</div></div>
        <div className="card stat"><div className="label">Bruttolön</div><div className="value">{kr(sum('gross_cash'))}</div></div>
        <div className="card stat"><div className="label">Skatteavdrag</div><div className="value">{kr(sum('tax'))}</div></div>
        <div className="card stat"><div className="label">Arbetsgivaravgifter</div><div className="value">{kr(sum('employer_fee'))}</div></div>
        {sum('pension') > 0 && <div className="card stat"><div className="label">Tjänstepension + särskild löneskatt</div><div className="value">{kr(sum('pension') + sum('pension_tax'))}</div></div>}
        <div className="card stat"><div className="label">Att betala ut</div><div className="value">{kr(sum('net_pay'))}</div></div>
      </div>
      {!draft && (
        <div className="card small">
          Bokförd av {run.booked_by} – <Link href={`${b}/verifikationer/${run.voucher_id}`}>visa verifikation</Link>.
          <br />Att betala till Skatteverkets skattekonto: skatteavdrag {kr(sum('tax'))} + arbetsgivaravgifter {kr(sum('employer_fee'))} = <b>{kr(sum('tax') + sum('employer_fee'))}</b>.
          Ladda upp AGI-filen i Skatteverkets e-tjänst Arbetsgivardeklaration → "Lämna via fil".
        </div>
      )}

      {slips.map((p) => (
        <div className="card" key={p.id} id={`p${p.id}`}>
          <div className="header" style={{ marginBottom: '.5rem' }}>
            <h2 style={{ margin: 0 }}>{p.name}</h2>
            <div className="actions" style={{ margin: 0 }}>
              <Link className="btn secondary" href={`${b}/lon/${run.id}/spec/${p.id}`}>Lönespecifikation</Link>
              {draft && <form action={removeSlip.bind(null, company.id, run.id, p.id)}><button className="link">Ta bort</button></form>}
            </div>
          </div>
          {draft ? (
            <form action={saveSlip.bind(null, company.id, run.id, p.id)} className="stack">
              <table>
                <thead><tr><th style={{ width: 260 }}>Typ</th><th>Beskrivning</th><th className="num" style={{ width: 150 }}>Belopp</th><th style={{ width: 110 }}>Konto (utlägg)</th></tr></thead>
                <tbody>
                  {[...p.items, ...Array.from({ length: 3 }, () => null)].map((it, i) => (
                    <tr key={i}>
                      <td><select name={`type_${i}`} defaultValue={it?.type ?? 'salary'}>
                        {Object.entries(PAY_ITEM_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select></td>
                      <td><input name={`desc_${i}`} defaultValue={it?.description ?? ''} placeholder={it ? '' : 'T.ex. Övertid, Sjukavdrag, Friskvård'} /></td>
                      <td><input name={`amount_${i}`} defaultValue={it ? fmt(it.amount) : ''} inputMode="decimal" style={{ textAlign: 'right' }} /></td>
                      <td><input name={`account_${i}`} defaultValue={it?.account ?? ''} placeholder="5800" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div><button className="secondary">Spara och räkna om</button></div>
            </form>
          ) : (
            <table>
              <tbody>{p.items.map((it, i) => <tr key={i}><td>{PAY_ITEM_LABELS[it.type]}</td><td>{it.description}</td><td className="num">{kr(it.amount)}</td></tr>)}</tbody>
            </table>
          )}
          <div className="grid small" style={{ marginTop: '.75rem' }}>
            <div>Kontant bruttolön<br /><b>{kr(p.gross_cash)}</b></div>
            <div>Förmåner<br /><b>{kr(p.benefits)}</b></div>
            <div>Skatt ({p.tax_info})<br /><b>{kr(p.tax)}</b></div>
            <div>Nettoavdrag / utlägg<br /><b>{kr(-p.net_deductions)} / {kr(p.reimbursements)}</b></div>
            <div>Nettolön<br /><b>{kr(p.net_pay)}</b></div>
            <div>Arbetsgivaravgift ({p.employer_fee_rate} %)<br /><b>{kr(p.employer_fee)}</b></div>
            {Number(p.pension) > 0 && <div>Tjänstepension<br /><b>{kr(p.pension)}</b> <span className="small muted">+ SLP {kr(p.pension_tax)}</span></div>}
          </div>
        </div>
      ))}

      {draft && (
        <>
          {others.length > 0 && (
            <form action={addEmployee.bind(null, company.id, run.id)} className="card row">
              <label>Lägg till anställd<select name="employee_id">{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <div style={{ flex: '0 0 auto' }}><button className="secondary">Lägg till</button></div>
            </form>
          )}
          <form action={applyAbsence.bind(null, company.id, run.id)} className="card actions">
            <button className="secondary">Räkna in frånvaro</button>
            <span className="muted small">Sjukfrånvaro (sjuklön 80 % och karensavdrag), semestertillägg och löneavdrag för VAB och ledighet som avslutats före {run.period}. <a href={`/c/${company.id}/lon/franvaro`}>Frånvaro och semester</a></span>
          </form>
          <div className="card actions">
            <form action={bookRun.bind(null, company.id, run.id)}><button>Bokför lönekörning</button></form>
            <form action={deleteRun.bind(null, company.id, run.id)}><button className="link">Ta bort utkast</button></form>
            <span className="muted small">Bokföring: 7210 Löner, 2710 Personalskatt, 7510/2731 Arbetsgivaravgifter, 1930 Nettolön, och vid tjänstepension 7411/2990 och särskild löneskatt 7533/2514. Därefter kan AGI-filen laddas ner.</span>
          </div>
        </>
      )}
    </>
  );
}
