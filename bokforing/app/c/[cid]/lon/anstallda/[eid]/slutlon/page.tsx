import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { finalPay } from '@/lib/final-pay';
import { proposal } from '@/lib/services/final-pay';
import { applyFinalPay } from './actions';

export const dynamic = 'force-dynamic';

/** Slutlön när anställningen upphör */
export default async function FinalPay({ params, searchParams }: { params: Promise<{ cid: string; eid: string }>; searchParams: SP }) {
  const { cid, eid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.slut ?? '')) ? String(sp.slut) : today();
  const p = await proposal(company.id, Number(eid), end);
  const b = `/c/${company.id}/lon/anstallda/${eid}`;
  const preview = finalPay({ monthly: p.employee.monthly, end, unusedDays: p.unused, savedDays: 0, earnedDays: p.earned, advanceDays: p.advance, rule: p.employee.rule, ownResignation: true });
  return (
    <div style={{ maxWidth: 900 }}>
      <p><Link href={b}>← {p.employee.name}</Link></p>
      <h1>Slutlön</h1>
      <Flash searchParams={searchParams} />
      {p.done ? <div className="card fp-done">Slutlönen är beräknad för anställningen som upphörde {p.done.end_date}: lön {kr(p.done.salary)} kr, semesterersättning {kr(p.done.vacation)} kr
        {p.done.advance ? `, avdrag förskottssemester ${kr(p.done.advance)} kr` : ''}. <Link href={`${b}/intyg?orsak=Anställningen har upphört`}>Underlag för arbetsgivarintyg</Link></div> : <>
        <p className="small">Vid anställningens slut betalas lön fram till sista dagen och semesterersättning för betalda semesterdagar som inte har tagits ut – årets outtagna, sparade dagar
          och dagar som har tjänats in under året. Har den anställde tagit ut fler dagar än som tjänats in (förskottssemester) får det dras av om den anställde själv säger upp sig.
          Semesterersättningen beräknas med 4,6 % av månadslönen och semestertillägg 0,43 % per dag (sammalöneregeln) eller 12 % av intjänad lön (procentregeln); kontrollera kollektivavtalet.</p>
        <form method="get" className="row"><label>Sista anställningsdag<input type="date" name="slut" defaultValue={end} /></label><div style={{ flex: '0 0 auto' }}><button className="secondary">Räkna om</button></div></form>
        <form action={applyFinalPay.bind(null, company.id, Number(eid))} className="card stack fp-form">
          <input type="hidden" name="end" value={end} />
          <div className="row">
            <label>Outtagna dagar i år<input name="unused_days" defaultValue={p.unused} style={{ width: '6rem' }} /></label>
            <label>Sparade dagar<input name="saved_days" defaultValue="0" style={{ width: '6rem' }} /></label>
            <label>Intjänade dagar till nästa år<input name="earned_days" defaultValue={p.earned} style={{ width: '6rem' }} /></label>
            <label>Förskottssemester (dagar)<input name="advance_days" defaultValue={p.advance} style={{ width: '6rem' }} /></label>
          </div>
          <div className="row">
            <label>Orsak<select name="reason"><option value="egen">Egen uppsägning</option><option value="arbetsgivare">Uppsägning från arbetsgivaren</option><option value="visstid">Visstidsanställning upphör</option></select></label>
            {p.employee.rule === 'percent' && <label>Semesterlönegrundande lön under året (kr)<input name="earned_pay" /></label>}
            <label>Lönekörning<select name="run_id" required>{p.runs.map((r) => <option key={r.id} value={r.id}>{r.period}</option>)}</select></label>
          </div>
          <p className="small muted fp-preview" style={{ margin: 0 }}>Förslag: lön {kr(preview.salary)} kr, semesterersättning {kr(preview.vacation)} kr ({preview.days} dagar à {kr(preview.perDay)} kr){preview.advance ? `, avdrag förskottssemester ${kr(preview.advance)} kr` : ''}.</p>
          {p.runs.length ? <div><button>Lägg slutlönen på lönespecen och avsluta anställningen</button></div> : <p className="small" style={{ color: 'var(--warn)' }}>Skapa först en lönekörning för slutmånaden där den anställda finns med.</p>}
        </form>
      </>}
    </div>
  );
}
