import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { MAX_COMPENSATION } from '@/lib/sick-pay';
import { year } from '@/lib/services/sick-pay';
import { bookSickClaim } from './actions';

export const dynamic = 'force-dynamic';
const pct = (x: number) => `${(x * 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} %`;

/** Högkostnadsskydd för sjuklön per år */
export default async function SickPay({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'payroll' });
  const sp = await searchParams;
  const y = /^\d{4}$/.test(String(sp.year)) ? Number(sp.year) : Number(today().slice(0, 4));
  const r = await year(company.id, y);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Högkostnadsskydd för sjuklön {y}</h1>
      <p className="small"><Link href={`/c/${company.id}/lon`}>← Lön</Link> · {[y - 1, y + 1].map((x) => <Link key={x} href={`?year=${x}`} style={{ marginRight: '.5rem' }}>{x}</Link>)}</p>
      <Flash searchParams={searchParams} />
      <p className="small">Försäkringskassan ersätter en del av sjuklönekostnaden när den är hög i förhållande till den totala lönekostnaden – i steg från 0,7 % av lönekostnaden, högst {kr(MAX_COMPENSATION)} kr per år.
        Sjuklönekostnaden (sjuklön och arbetsgivaravgifter på den) redovisas i arbetsgivardeklarationen varje månad.</p>
      <table className="sp-months"><thead><tr><th>Månad</th><th className="num">Sjuklön</th><th className="num">Sjuklönekostnad</th><th className="num">Total lönekostnad</th></tr></thead>
        <tbody>{r.months.map((m) => <tr key={m.period}><td>{m.period}</td><td className="num">{kr(m.sickPay)}</td><td className="num">{kr(m.sickCost)}</td><td className="num">{kr(m.totalCost)}</td></tr>)}
          {!r.months.length && <tr><td colSpan={4} className="muted">Inga bokförda lönekörningar för året.</td></tr>}</tbody></table>
      <div className="grid">
        <div className="card stat"><div className="label">Sjuklönekostnadens andel</div><div className="value sp-ratio">{pct(r.ratio)}</div></div>
        <div className="card stat"><div className="label">Beräknad ersättning</div><div className="value sp-amount">{kr(r.amount)}</div></div>
      </div>
      {r.bands.length > 0 && <table className="small"><tbody>{r.bands.map((b) => <tr key={b.from}><td>{pct(b.from)}–{b.to === Infinity ? '' : pct(b.to)} av lönekostnaden ersätts med {pct(b.share)}</td><td className="num">{kr(b.base)}</td><td className="num">{kr(b.amount)}</td></tr>)}</tbody></table>}
      {r.claim ? <p className="sp-booked">Fordran {kr(r.claim.amount)} kr är bokförd{r.claim.voucher_id && <> i <Link href={`/c/${company.id}/verifikationer/${r.claim.voucher_id}`}>verifikationen</Link></>}.</p>
        : r.amount > 0 && <form action={bookSickClaim.bind(null, company.id, y)}><button>Bokför fordran på Försäkringskassan per {y}-12-31 (1689 / 3990)</button></form>}
    </div>
  );
}
