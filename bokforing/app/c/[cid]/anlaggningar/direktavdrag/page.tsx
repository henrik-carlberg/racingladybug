import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { parseAmount } from '@/lib/money';
import { classify } from '@/lib/small-assets';
import { review } from '@/lib/services/small-assets';
import { activate, keep } from './actions';

export const dynamic = 'force-dynamic';
const DECISION: Record<string, string> = { short_life: 'Korttidsinventarie', keep: 'Direktavdrag behålls', activated: 'Aktiverad' };

/** Inventarier av mindre värde och korttidsinventarier: direktavdrag eller aktivering */
export default async function DirectDeduction({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const year = /^\d{4}$/.test(String(sp.ar ?? '')) ? Number(sp.ar) : Number(today().slice(0, 4));
  const r = await review(company.id, year);
  const price = sp.price ? parseAmount(String(sp.price)) : null;
  const calc = price != null ? classify({ price, lifeYears: Number(sp.life ?? 5), related: parseAmount(String(sp.related ?? '')) ?? 0, year }) : null;
  return (
    <div style={{ maxWidth: 1000 }}>
      <p><Link href={`/c/${company.id}/anlaggningar`}>← Anläggningsregister</Link></p>
      <h1>Direktavdrag för inventarier</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Inventarier med en ekonomisk livslängd på högst tre år (korttidsinventarier) och inventarier av mindre värde – under ett halvt prisbasbelopp,
        {' '}{kr(r.half)} kr exkl. moms för {year} – får dras av direkt. Inventarier som hör ihop (en inventariesamling eller ett naturligt samband, t.ex. möblering av ett kontor)
        bedöms tillsammans. Dyrare inventarier tas upp i anläggningsregistret och skrivs av enligt plan; skattemässigt med 30-regeln eller kompletteringsregeln.</p>
      <form method="get" className="card row">
        <input type="hidden" name="ar" value={year} />
        <label>Pris exkl. moms (kr)<input name="price" defaultValue={String(sp.price ?? '')} style={{ width: '8rem' }} /></label>
        <label>Ekonomisk livslängd (år)<input name="life" defaultValue={String(sp.life ?? '5')} style={{ width: '5rem' }} /></label>
        <label>Hela anskaffningen om den hör ihop (kr)<input name="related" defaultValue={String(sp.related ?? '')} style={{ width: '8rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Bedöm</button></div>
      </form>
      {calc && <p className={`card da-verdict da-${calc.verdict}`}><b>{calc.verdict === 'asset' ? 'Ska skrivas av' : 'Direktavdrag'}</b>: {calc.reason}.</p>}
      <h2>Kostnadsförda inventarier att bedöma {year}</h2>
      {!r.flagged.length && <p className="muted da-none">Inga inköp på förbrukningsinventarier (5410) över gränsen.</p>}
      {r.flagged.map((f) => (
        <section key={f.voucherId} className="card stack da-row" data-voucher={f.label}>
          <div><b>{f.label}</b> {f.date} · {f.text} · <b>{kr(f.amount)} kr</b>
            {f.flagged === 'related' && <span className="small" style={{ color: 'var(--warn)' }}> · samma dag och leverantör {kr(f.group)} kr tillsammans</span>}</div>
          <div className="row">
            <form action={activate.bind(null, company.id, year, f.voucherId)} className="row" style={{ gap: '.25rem' }}>
              <select name="category"><option value="inventarier">Inventarier</option><option value="maskiner">Maskiner</option><option value="datorer">Datorer</option><option value="bilar">Bilar</option></select>
              <button>Aktivera och skriv av</button></form>
            <form action={keep.bind(null, company.id, year, f.voucherId)} className="row" style={{ gap: '.25rem' }}>
              <select name="decision"><option value="short_life">Korttidsinventarie (högst 3 år)</option><option value="keep">Behåll direktavdrag</option></select>
              <input name="note" placeholder="Motivering" maxLength={500} /><button className="secondary">Spara bedömning</button></form>
          </div>
        </section>
      ))}
      {r.decided.length > 0 && <><h3>Bedömda</h3><table className="da-decided"><tbody>{r.decided.map((d) => <tr key={d.voucher_id}><td>{d.label}</td><td>{d.date}</td><td>{DECISION[d.decision]}</td><td>{d.note}</td></tr>)}</tbody></table></>}
    </div>
  );
}
