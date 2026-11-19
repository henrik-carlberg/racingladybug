import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { fiscalYears } from '@/lib/server/ledger';
import { fxBasis } from '@/lib/services/fx-revaluation';
import { revalue } from './actions';

export const dynamic = 'force-dynamic';
const KIND: Record<string, string> = { bank: 'Bankkonto', receivable: 'Kundfordran', payable: 'Leverantörsskuld' };
const amt = (o: number) => (o / 100).toFixed(2).replace('.', ',');

export default async function Fx({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const sp = await searchParams;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const years = await fiscalYears(company.id);
  const open = years.filter((y) => !y.closed).sort((a, b) => a.end_date.localeCompare(b.end_date));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.datum)) ? String(sp.datum) : (open[0]?.end_date ?? years.at(-1)?.end_date ?? '');
  const basis = await fxBasis(company.id, date);
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 1000 }}>
      <div className="header"><h1>Omvärdering av valuta</h1><Link className="btn secondary" href={`${b}/bokslut`}>Bokslut</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">Tillgångar och skulder i utländsk valuta värderas till balansdagens kurs. Valutakonton i banken justeras mot 8330, obetalda kund- och leverantörsfakturor mot 3960 (kursvinst) och 7960 (kursförlust). Kund- och leverantörsdelen återförs dagen efter så att kursdifferensen blir rätt när fakturan betalas.</p>
      <form className="card row" style={{ alignItems: 'end' }}>
        <label style={{ flex: '0 0 200px' }}>Balansdag<input type="date" name="datum" defaultValue={date} /></label>
        <div style={{ flex: '0 0 auto' }}><button className="secondary">Visa</button></div>
      </form>
      {basis.booked ? <p className="card">Omvärderingen per {date} är bokförd – <Link href={`${b}/verifikationer/${basis.booked}`}>visa verifikation</Link>.</p>
        : !basis.items.length ? <p className="muted">Det finns inga valutakonton eller obetalda fakturor i utländsk valuta per {date}. Lägg till ett valutakonto under Bank (ange valuta när du skapar kontot).</p> : (
        <form action={revalue.bind(null, company.id, date)} className="stack">
          <div className="card row">{basis.currencies.map((c) => <label key={c} style={{ flex: '0 0 200px' }}>Kurs {c} per {date}<input name={`rate_${c}`} inputMode="decimal" placeholder="T.ex. 11,25" required /></label>)}</div>
          <table>
            <thead><tr><th>Post</th><th>Typ</th><th>Konto</th><th className="num">Belopp i valuta</th><th className="num">Bokfört i kronor</th></tr></thead>
            <tbody>{basis.items.map((i) => (
              <tr key={i.ref}><td>{i.label}</td><td>{KIND[i.kind]}</td><td>{i.account}</td>
                <td className="num">{i.kind === 'bank' ? <input name={`amount_${i.ref.replace(':', '_')}`} defaultValue={amt(i.amountCurrency)} inputMode="decimal" style={{ width: 130, textAlign: 'right' }} aria-label={`Saldo ${i.label}`} /> : `${amt(i.amountCurrency)}`} {i.currency}</td>
                <td className="num">{kr(i.bookedSek)}</td></tr>
            ))}</tbody>
          </table>
          <div><button>Bokför omvärdering per {date}</button></div>
        </form>
      )}
    </div>
  );
}
