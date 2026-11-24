import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { overview } from '@/lib/services/fx-exposure';
import { settingsAction } from './actions';

export const dynamic = 'force-dynamic';
const cur = (cents: number) => (cents / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function FxExposure({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const id = company.id;
  const o = await overview(id);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Valutaexponering</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Bolagets tillgångar och skulder i utländsk valuta just nu: valutakonton, obetalda kundfakturor och leverantörsfakturor. Sålda <Link href={`/c/${id}/valutaterminer`}>valutaterminer</Link> säkrar tillgångar och köpta säkrar skulder.
        Känslighetsanalysen visar hur resultatet påverkas om valutan stärks eller försvagas mot kronan. Ange dagens kurs – annars används den bokförda kursen – och en gräns för hur stor den osäkrade exponeringen får vara.</p>
      {o.rows.filter((r) => r.over).map((r) => <div key={r.currency} className="card small fx-warning" data-currency={r.currency}>Den osäkrade exponeringen i {r.currency} är {kr(r.unhedgedSek ?? 0)} kr – över gränsen {kr(r.limit ?? 0)} kr. Överväg en valutatermin.</div>)}
      <table className="fx-table"><thead><tr><th>Valuta</th><th className="num">Bank</th><th className="num">Kundfordringar</th><th className="num">Leverantörsskulder</th><th className="num">Netto</th><th className="num">Säkrat</th><th className="num">Osäkrat</th><th className="num">Osäkrat i kr</th></tr></thead>
        <tbody>{o.rows.map((r) => <tr key={r.currency} className="fx-row" data-currency={r.currency}><td>{r.currency}</td><td className="num">{cur(r.bank)}</td><td className="num">{cur(r.receivables)}</td><td className="num">{cur(r.payables)}</td>
          <td className="num fx-net">{cur(r.net)}</td><td className="num fx-hedge">{cur(r.hedge)}{r.hedgedShare != null && <div className="small muted">{r.hedgedShare} %</div>}</td><td className="num fx-unhedged">{cur(r.unhedged)}</td><td className="num fx-unhedged-sek">{r.unhedgedSek != null ? kr(r.unhedgedSek) : '–'}</td></tr>)}
          {!o.rows.length && <tr><td colSpan={8} className="muted">Inga poster i utländsk valuta.</td></tr>}</tbody></table>
      {o.rows.length > 0 && <><h2>Känslighet</h2>
        <table className="small fx-sens"><thead><tr><th>Valuta</th><th className="num">Kurs</th>{[-10, -5, 5, 10].map((p) => <th key={p} className="num">{p > 0 ? '+' : ''}{p} %</th>)}<th>Kurs och gräns</th></tr></thead>
          <tbody>{o.rows.map((r) => <tr key={r.currency} data-currency={r.currency}><td>{r.currency}</td><td className="num">{r.rate != null ? r.rate.toLocaleString('sv-SE', { maximumFractionDigits: 4 }) : '–'}</td>
            {r.sensitivity.map((s) => <td key={s.pct} className="num" data-pct={s.pct}>{s.effect != null ? kr(s.effect) : '–'}</td>)}
            <td><form action={settingsAction.bind(null, id, r.currency)} className="row" style={{ gap: '.25rem' }}><input name="rate" defaultValue={r.manualRate ?? ''} placeholder="Dagens kurs" style={{ width: '6rem' }} /><input name="limit" defaultValue={r.limit != null ? String(r.limit / 100) : ''} placeholder="Gräns i kr" style={{ width: '7rem' }} /><button className="link">Spara</button></form></td></tr>)}</tbody></table></>}
    </div>
  );
}
