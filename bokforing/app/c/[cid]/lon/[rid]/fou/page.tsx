import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { FOU_MONTHLY_CAP, MIN_HOURS } from '@/lib/fou';
import { overview } from '@/lib/services/fou';
import { bookFou, setHours } from './actions';

export const dynamic = 'force-dynamic';

/** Forskningsavdrag: nedsatta arbetsgivaravgifter för den som arbetar med forskning och utveckling */
export default async function Fou({ params, searchParams }: { params: Promise<{ cid: string; rid: string }>; searchParams: SP }) {
  const { cid, rid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const o = await overview(company.id, Number(rid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Forskningsavdrag {o.run.period}</h1>
      <p className="small"><Link href={`${b}/lon/${o.run.id}`}>← Lönekörningen</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">Arbetsgivaravgifterna sätts ned med 20 % av avgiftsunderlaget för den som arbetar med forskning eller utveckling minst {MIN_HOURS} timmar och minst halva arbetstiden under månaden,
        högst {kr(FOU_MONTHLY_CAP)} kr per månad och aldrig under ålderspensionsavgiften. Spara underlaget för tiden – Skatteverket kan begära det.</p>
      <table className="fou-slips"><thead><tr><th>Anställd</th><th className="num">Underlag</th><th>FoU-tid / total tid (timmar)</th><th className="num">Avdrag</th></tr></thead>
        <tbody>{o.rows.map((r) => (
          <tr key={r.id} className={`fou-row ${r.qualifies ? 'ok' : ''}`} data-name={r.name}>
            <td>{r.name}{r.reason && <div className="small muted">{r.reason}</div>}</td><td className="num">{kr(r.base)}</td>
            <td>{o.booked ? `${r.fouHours} / ${r.totalHours}` : <form action={setHours.bind(null, company.id, o.run.id, r.id)} className="row">
              <input name="fou_hours" defaultValue={r.fouHours || ''} aria-label="Timmar FoU" style={{ width: '5rem' }} /> / <input name="total_hours" defaultValue={r.totalHours || ''} aria-label="Timmar totalt" style={{ width: '5rem' }} />
              <input name="description" defaultValue={r.description} placeholder="Projekt" aria-label="Projekt" style={{ width: '10rem' }} /><button className="secondary small">Spara</button></form>}</td>
            <td className="num fou-amount">{kr(r.amount)}</td></tr>))}</tbody></table>
      <div className="grid">
        <div className="card stat"><div className="label">Underlag för avdrag</div><div className="value fou-base">{kr(o.base)}</div></div>
        <div className="card stat"><div className="label">Avdrag för forskning och utveckling</div><div className="value fou-total">{kr(o.total)}</div>{o.capped && <div className="small muted">Begränsat av taket</div>}</div>
      </div>
      {o.booked ? <p className="fou-booked">Avdraget är bokfört{o.booked.voucher_id && <> i <Link href={`${b}/verifikationer/${o.booked.voucher_id}`}>verifikationen</Link></>}.</p>
        : <form action={bookFou.bind(null, company.id, o.run.id)}><button disabled={!o.total || o.run.status !== 'booked'}>Bokför avdraget (minskar 7510 mot 2731)</button>{o.run.status !== 'booked' && <span className="small muted"> Bokför lönekörningen först.</span>}</form>}
      <p className="small muted">I arbetsgivardeklarationen anges underlaget och avdraget för forskning och utveckling i huvuduppgiften. Fyll i dem i Skatteverkets e-tjänst när du lämnar deklarationen för perioden.</p>
    </div>
  );
}
