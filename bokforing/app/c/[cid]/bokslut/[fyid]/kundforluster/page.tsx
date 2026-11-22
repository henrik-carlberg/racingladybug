import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { reserve } from '@/lib/services/bad-debts';
import { assessAction, reserveAction } from './actions';

export const dynamic = 'force-dynamic';

/** Kundförluster i bokslutet: reserv för befarade förluster och årets konstaterade */
export default async function BadDebts({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const ctx = await requireCompany(cid, { perm: 'ledger' });
  const id = ctx.company.id;
  const r = await reserve(id, Number(fyid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Kundförluster {r.fy.start_date.slice(0, 4)}</h1>
      <p className="small"><Link href={`/c/${id}/bokslut/${r.fy.id}`}>← Bokslutet</Link></p>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Befarade (exkl. moms)</div><div className="value bd-target">{kr(r.target)}</div></div>
        <div className="card stat"><div className="label">Reserv på 1519 nu</div><div className="value bd-current">{kr(r.current)}</div></div>
        <div className="card stat"><div className="label">Konstaterade i år</div><div className="value bd-written">{kr(r.writtenOff.amount)}</div><div className="small muted">{r.writtenOff.n} fakturor</div></div>
      </div>
      <h2>Befarade kundförluster per {r.fy.end_date}</h2>
      <p className="small">Fakturor som förföll före {r.limit} (mer än 90 dagar) eller har lämnats till inkasso. Reserven görs exklusive moms –
        momsen sätts ned först när förlusten är konstaterad (skriv då bort fakturan från fakturasidan).</p>
      <table className="bd-doubtful"><thead><tr><th>Faktura</th><th>Kund</th><th>Förföll</th><th className="num">Kvar</th><th className="num">Exkl. moms</th><th className="num">Andel</th><th className="num">Reserv</th><th>Bedömning</th></tr></thead>
        <tbody>{[...r.doubtful, ...r.others].map((d) => (
          <tr key={d.id} className="bd-row" data-number={d.number ?? ''}><td><Link href={`/c/${id}/fakturor/${d.id}`}>{d.number}</Link></td><td>{d.customer}</td><td>{d.due}</td><td className="num">{kr(d.remaining)}</td><td className="num">{kr(d.net)}</td>
            <td className="num bd-pct">{d.pct} %</td><td className="num bd-reserve">{kr(d.reserve)}</td>
            <td>{d.collection && <span className="badge warn">Inkasso</span>} {d.disputed && <span className="badge warn">Tvist</span>} {d.assessed && <span className="small muted">{d.assessed.note}</span>}
              {!r.fy.closed && <form action={assessAction.bind(null, id, r.fy.id, d.id)} className="row" style={{ gap: '.25rem' }}><input name="pct" defaultValue={d.assessed ? d.assessed.pct : ''} placeholder="%" style={{ width: '4rem' }} />
                <input name="note" defaultValue={d.assessed?.note ?? ''} placeholder="Motivering" maxLength={500} /><button className="link">Spara</button></form>}</td></tr>))}
          {!r.doubtful.length && !r.others.length && <tr><td colSpan={8} className="muted">Inga fakturor ser osäkra ut.</td></tr>}</tbody></table>
      {r.change !== 0 && !r.fy.closed && (
        <div className="card stack" style={{ marginTop: '1rem' }}>
          <p style={{ margin: 0 }}>{r.change > 0 ? `Öka reserven med ${kr(r.change)} kr: debet 6352, kredit 1519.` : `Lös upp ${kr(-r.change)} kr av reserven: debet 1519, kredit 6352.`} Bokförs {r.fy.end_date}.</p>
          <form action={reserveAction.bind(null, id, r.fy.id)}><button>Bokför reserven</button></form>
        </div>
      )}
      <p className="small muted">Skattemässigt är en befarad förlust avdragsgill när den är sannolik och beräknad efter en individuell bedömning – en schablonmässig reserv godtas inte.
        Kontrollera därför varje faktura i listan.</p>
    </div>
  );
}
