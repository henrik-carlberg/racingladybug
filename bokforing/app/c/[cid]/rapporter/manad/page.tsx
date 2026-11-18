import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import { addMonths, periodOf } from '@/lib/assets';
import { RESULT_GROUPS, change } from '@/lib/monthly';
import { monthlyReport } from '@/lib/services/monthly';

export const dynamic = 'force-dynamic';

const pct = (v: number | null) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toLocaleString('sv-SE')} %`);

export default async function Monthly({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid);
  const sp = await searchParams;
  const p = String(sp.period ?? addMonths(periodOf(today()), -1));
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(p) ? p : addMonths(periodOf(today()), -1);
  const r = await monthlyReport(company.id, period);
  const b = `/c/${company.id}`;
  return (
    <div>
      <div className="header">
        <h1>Månadsrapport {period}</h1>
        <div className="actions" style={{ margin: 0 }}>
          <Link className="btn secondary" href={`${b}/rapporter/manad?period=${addMonths(period, -1)}`}>← {addMonths(period, -1)}</Link>
          <Link className="btn secondary" href={`${b}/rapporter/manad?period=${addMonths(period, 1)}`}>{addMonths(period, 1)} →</Link>
          <PrintButton />
        </div>
      </div>
      <p className="muted">{company.name} · {r.from} – {r.to} · {r.vouchers} verifikationer</p>
      <div className="card"><ul style={{ margin: 0 }}>{r.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul></div>
      <div className="grid">
        <div className="card stat"><div className="label">Intäkter</div><div className="value">{kr(r.month.revenue)}</div><div className="small muted">{pct(change(r.month.revenue, r.prevYear.revenue))} mot i fjol</div></div>
        <div className="card stat"><div className="label">Resultat</div><div className="value" style={r.month.result < 0 ? { color: 'var(--danger)' } : undefined}>{kr(r.month.result)}</div><div className="small muted">i år {kr(r.ytd.result)}</div></div>
        <div className="card stat"><div className="label">Kassa och bank</div><div className="value">{kr(r.cash)}</div><div className="small muted">{r.cash >= r.cashPrev ? '+' : ''}{kr(r.cash - r.cashPrev)} under månaden</div></div>
        <div className="card stat"><div className="label">Kundfordringar</div><div className="value">{kr(r.receivables)}</div><div className="small muted">förfallet {kr(r.overdue)}</div></div>
      </div>
      <h2>Resultat</h2>
      <div className="table-wrap"><table>
        <thead><tr><th></th><th className="num">{period}</th><th className="num">Samma månad i fjol</th><th className="num">Förändring</th><th className="num">Hittills i år</th></tr></thead>
        <tbody>
          {RESULT_GROUPS.map((g) => (
            <tr key={g.key}><td>{g.label}</td><td className="num">{kr(r.month[g.key])}</td><td className="num">{kr(r.prevYear[g.key])}</td><td className="num">{pct(change(r.month[g.key], r.prevYear[g.key]))}</td><td className="num">{kr(r.ytd[g.key])}</td></tr>
          ))}
          <tr className="sum"><td><b>Resultat</b></td><td className="num"><b>{kr(r.month.result)}</b></td><td className="num">{kr(r.prevYear.result)}</td><td className="num">{pct(change(r.month.result, r.prevYear.result))}</td><td className="num"><b>{kr(r.ytd.result)}</b></td></tr>
        </tbody>
      </table></div>
      <p className="small muted">Kostnader visas som positiva belopp. Hittills i år räknas från räkenskapsårets början ({r.ytdFrom}).</p>
      {r.topCosts.length > 0 && (
        <>
          <h2>Största kostnaderna</h2>
          <table><tbody>{r.topCosts.map((c) => <tr key={c.account}><td>{c.account} {c.name}</td><td className="num">{kr(c.amount)}</td></tr>)}</tbody></table>
        </>
      )}
      <h2>Ställning vid månadens slut</h2>
      <table><tbody>
        <tr><td>Kassa och bank (19xx)</td><td className="num">{kr(r.cash)}</td></tr>
        <tr><td>Kundfordringar (obetalda kundfakturor)</td><td className="num">{kr(r.receivables)}</td></tr>
        <tr><td>Leverantörsskulder (obetalda leverantörsfakturor)</td><td className="num">{kr(r.payables)}</td></tr>
        <tr><td>Moms att betala (26xx)</td><td className="num">{kr(r.vatDue)}</td></tr>
      </tbody></table>
    </div>
  );
}
