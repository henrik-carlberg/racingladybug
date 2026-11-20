import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { appropriations } from '@/lib/services/tax-planning';
import { depreciationMethods } from '@/lib/tax-planning';
import { appropriate } from '../../../skatt/actions';

export const dynamic = 'force-dynamic';
const NAME: Record<string, string> = { koncernbidrag: 'Koncernbidrag', overavskrivning: 'Överavskrivningar', periodiseringsfond: 'Periodiseringsfond', aterforing: 'Återföring av periodiseringsfond', aterforing_overavskrivning: 'Återföring av överavskrivningar' };

export default async function Appropriations({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const a = await appropriations(id, Number(fyid), ctx.user.id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const fy = a.status.fy;
  const open = a.proposals.filter((p) => !a.booked.some((b) => b.kind === p.kind));
  const dm = depreciationMethods(a.inventories);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Bokslutsdispositioner {fy.start_date.slice(0, 4)}</h1>
      <p className="small"><Link href={`/c/${id}/bokslut/${fy.id}`}>← Bokslutet</Link></p>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Resultat före dispositioner</div><div className="value">{kr(a.resultBefore)}</div></div>
        <div className="card stat"><div className="label">Skatt utan dispositioner</div><div className="value">{kr(a.taxBefore)}</div></div>
        <div className="card stat"><div className="label">Skatt med alla förslag</div><div className="value">{kr(a.taxAfter)}</div><div className="small muted">{a.taxBefore > a.taxAfter ? `${kr(a.taxBefore - a.taxAfter)} kr lägre (uppskjuten)` : ''}</div></div>
      </div>
      {a.status.companyType === 'EF' && <p className="small muted">Enskild firma: skatteeffekten är en uppskattning med 50 % marginaleffekt (skatt och egenavgifter).</p>}
      {open.length === 0 && a.booked.length === 0 && <div className="card">Inga dispositioner att föreslå – resultatet är noll eller negativt.</div>}
      {open.map((p) => (
        <div key={p.kind} className="card stack proposal" data-kind={p.kind}>
          <div className="header" style={{ margin: 0 }}><h2 style={{ margin: 0, fontSize: '1.05rem' }}>{p.title}{p.required && <span className="badge warn" style={{ marginLeft: '.5rem' }}>Måste göras</span>}</h2>
            <b>{kr(p.amount)} kr</b></div>
          <p style={{ margin: 0 }}>{p.explanation}</p>
          <p className="small" style={{ margin: 0 }}>{p.taxEffect >= 0 ? `Skatten blir ${kr(p.taxEffect)} kr lägre i år.` : `Skatten blir ${kr(-p.taxEffect)} kr högre i år.`}
            {' '}Bokförs {fy.end_date}: {p.lines.map((l) => `${l.amount > 0 ? 'debet' : 'kredit'} ${l.account} ${kr(Math.abs(l.amount))}`).join(', ')}.</p>
          {!fy.closed && <form action={appropriate.bind(null, id, fy.id, p.kind)}><button>Bokför {NAME[p.kind].toLowerCase()}</button></form>}
        </div>
      ))}
      {dm.base > 0 && (
        <section className="card depreciation-methods">
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Inventariernas skattemässiga värde</h2>
          <table className="dep-methods"><thead><tr><th>Metod</th><th className="num">Största avskrivning</th><th className="num">Skattemässigt värde</th></tr></thead>
            <tbody>{dm.rows.map((r) => <tr key={r.rule} className="dep-row"><td>{r.rule}</td><td className="num">{kr(r.depreciation)}</td><td className="num">{kr(r.taxValue)}</td></tr>)}</tbody></table>
          <p className="small" style={{ margin: '.4rem 0 0' }}>Avskrivningsunderlag {kr(dm.base)} kr. Bokfört värde {kr(dm.bookEnd ?? 0)} kr, lägsta skattemässiga värde {kr(dm.lowest)} kr – överavskrivningarna får vara högst <b className="max-reserve">{kr(dm.maxReserve ?? 0)}</b> kr. Bokfört på 2150: <b className="reserve-now">{kr(dm.reserve)}</b> kr.
            {dm.reversal > 0 ? ' Reserven är för stor och måste återföras.' : ''} Restvärdesmetoden gäller bara om inventarierna inte skrivs av räkenskapsenligt.</p>
        </section>
      )}
      {a.booked.length > 0 && (
        <>
          <h2>Bokförda</h2>
          <table><tbody>{a.booked.map((b) => <tr key={b.kind} className="booked-appr"><td>{NAME[b.kind]}</td><td className="num">{kr(b.amount)}</td>
            <td>{b.voucher_id && <Link href={`/c/${id}/verifikationer/${b.voucher_id}`}>Verifikation</Link>}</td></tr>)}</tbody></table>
        </>
      )}
      <p className="small muted">Förslagen räknas i ordningen återföring, koncernbidrag, överavskrivningar och sist periodiseringsfond (25 % för aktiebolag, 30 % för enskild firma av överskottet som återstår).
        Bokför dispositionerna innan du bokför årets skatt.</p>
    </div>
  );
}
