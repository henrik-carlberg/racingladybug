import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { list } from '@/lib/services/fx-forwards';
import { addForward, settle, valuate } from './actions';

export const dynamic = 'force-dynamic';

/** Valutaterminer: säkring, värdering i bokslutet och avräkning */
export default async function FxForwards({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const rows = await list(company.id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Valutaterminer</h1>
      <Flash searchParams={searchParams} />
      <p className="small">En valutatermin låser kursen för en framtida betalning. Säkrar terminen en kund- eller leverantörsfaktura tas den säkrade posten upp till terminskursen och terminen värderas inte separat.
        En osäkrad termin värderas i bokslutet enligt lägsta värdets princip: ett orealiserat undervärde reserveras, ett övervärde tas inte upp. Vid förfall bokförs kursvinsten eller kursförlusten.</p>
      <table className="fx-list"><thead><tr><th>Termin</th><th>Förfaller</th><th>Säkrar</th><th className="num">Reserv</th><th></th></tr></thead>
        <tbody>{rows.map((f) => (
          <tr key={f.id} className="fx-row" data-currency={f.currency}><td>{f.direction === 'sell' ? 'Sälj' : 'Köp'} {f.amount.toLocaleString('sv-SE')} {f.currency} à {f.forward_rate}</td><td>{f.maturity}</td><td className="small">{f.hedged || 'Osäkrad'}</td>
            <td className="num fx-reserve">{kr(f.reserved)}</td>
            <td>{f.status === 'settled' ? <span className="fx-settled">Avräknad mot {f.spot_rate}: {kr(f.result ?? 0)} kr</span> : <div className="stack">
              <form action={valuate.bind(null, company.id, f.id)} className="row"><input type="date" name="date" defaultValue={`${t.slice(0, 4)}-12-31`} aria-label="Bokslutsdag" /><input name="rate" placeholder="Balansdagskurs" aria-label="Balansdagskurs" style={{ width: '7rem' }} /><button className="secondary small">Värdera</button></form>
              <form action={settle.bind(null, company.id, f.id)} className="row"><input type="date" name="date" defaultValue={f.maturity} aria-label="Datum" /><input name="spot_rate" placeholder="Avistakurs" aria-label="Avistakurs" style={{ width: '7rem' }} /><button className="secondary small">Avräkna</button></form>
            </div>}</td></tr>))}
          {!rows.length && <tr><td colSpan={5} className="muted">Inga terminer.</td></tr>}</tbody></table>
      <form action={addForward.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Riktning<select name="direction"><option value="sell">Sälj valuta (säkrar fordran)</option><option value="buy">Köp valuta (säkrar skuld)</option></select></label>
        <label>Valuta<input name="currency" defaultValue="EUR" maxLength={3} style={{ width: '4rem' }} /></label>
        <label>Belopp i valutan<input name="amount" required style={{ width: '8rem' }} /></label>
        <label>Terminskurs (kr)<input name="forward_rate" required style={{ width: '6rem' }} /></label>
        <label>Affärsdag<input type="date" name="trade_date" defaultValue={t} required /></label>
        <label>Förfallodag<input type="date" name="maturity" required /></label>
        <label>Säkrad post (lämna tomt om osäkrad)<input name="hedged" placeholder="T.ex. kundfaktura 1042" /></label>
        <div style={{ flex: '0 0 auto' }}><button>Registrera termin</button></div>
      </form>
    </div>
  );
}
