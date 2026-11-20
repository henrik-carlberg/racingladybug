import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { type SP } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';
import { kr, today } from '@/lib/format';
import { report } from '@/lib/services/company-grants';

export const dynamic = 'force-dynamic';
const KIND: Record<string, string> = { payment: 'Utbetalning', recognition: 'Intäktsfört', provision: 'Återbetalningsskuld', repayment: 'Återbetalat' };

export default async function GrantReport({ params, searchParams }: { params: Promise<{ cid: string; gid: string }>; searchParams: SP }) {
  const { cid, gid } = await params;
  const sp = await searchParams;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const r = await report(ctx.company.id, Number(gid) || 0, iso(sp.from), iso(sp.to));
  const g = r.grant;
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="header"><h1>Ekonomisk rapport: {g.name}</h1><div className="actions" style={{ margin: 0 }}><Link className="btn secondary" href={`/c/${cid}/bidrag`}>Tillbaka</Link><PrintButton /></div></div>
      <form className="row no-print"><label>Från<input type="date" name="from" defaultValue={r.from} /></label><label>Till<input type="date" name="to" defaultValue={r.to} /></label><button className="secondary">Visa</button></form>
      <p>{ctx.company.name} ({ctx.company.orgnr}) · Bidragsgivare: {g.grantor}{g.reference && `, dnr ${g.reference}`} · Projekt: {g.project}<br />Rapportperiod {r.from} – {r.to} · Beviljat {kr(g.amount)} kr ({g.coverage_pct.toLocaleString('sv-SE')} % av stödberättigande kostnader) · Upprättad {today()}</p>
      <h2>Redovisade kostnader under perioden</h2>
      <table className="grant-costs"><thead><tr><th>Konto</th><th>Benämning</th><th className="num">Belopp</th></tr></thead>
        <tbody>{r.byAccount.map((c) => <tr key={c.account}><td>{c.account}</td><td>{c.name}</td><td className="num">{kr(c.amount)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2}>Summa under perioden</td><td className="num period-costs">{kr(r.periodCosts)}</td></tr></tfoot></table>
      <h2>Ackumulerat från projektstart</h2>
      <table className="grant-total"><tbody>
        <tr><td>Stödberättigande kostnader</td><td className="num">{kr(r.total.costs)}{r.total.budgetUsedPct != null && ` (${r.total.budgetUsedPct.toLocaleString('sv-SE')} % av budget ${kr(g.budget)} kr)`}</td></tr>
        <tr><td>Intjänat bidrag</td><td className="num">{kr(r.total.earned)}</td></tr>
        <tr><td>Utbetalt hittills</td><td className="num">{kr(g.received)}</td></tr>
        <tr><td><b>Att rekvirera</b></td><td className="num to-request"><b>{kr(r.total.toRequest)}</b></td></tr>
        <tr><td>Återstår av beviljat bidrag</td><td className="num">{kr(r.total.remainingGrant)}</td></tr>
      </tbody></table>
      <h2>Händelser</h2>
      <ul className="small">{r.events.map((e, i) => <li key={i}>{e.date} {KIND[e.kind] ?? e.kind}: {kr(e.amount)} kr</li>)}</ul>
      <p className="small muted">Kostnaderna är hämtade ur bokföringen (konton 4000–7999 märkta med projektet). Underlag finns i verifikationerna.</p>
    </div>
  );
}
