import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { USE_YEARS } from '@/lib/replacement-fund';
import { list } from '@/lib/services/replacement-fund';
import { addClaim, setFund, useFund } from './actions';

export const dynamic = 'force-dynamic';

/** Försäkringsersättning och ersättningsfond */
export default async function ReplacementFund({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const rows = await list(company.id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Försäkringsersättning och ersättningsfond</h1>
      <p className="small"><Link href={`/c/${company.id}/bokslut`}>← Bokslut</Link></p>
      <Flash searchParams={searchParams} />
      <p className="small">När inventarier eller en byggnad skadas och försäkringen betalar ut ersättning blir ersättningen skattepliktig. Genom en avsättning till ersättningsfond (2160) skjuts skatten upp –
        fonden ska tas i anspråk när tillgången återanskaffas, senast {USE_YEARS} år efter avsättningsåret. Annars återförs den till beskattning, och Skatteverket tar då ut ett särskilt tillägg.</p>
      <table className="rf-claims"><thead><tr><th>Skada</th><th className="num">Ersättning</th><th className="num">Fond</th><th className="num">Kvar</th><th>Senast</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={`rf-row ${r.overdue ? 'overdue' : ''}`} data-desc={r.description}>
            <td>{r.description} <span className="small muted">{r.kind}, {r.damage_date}</span></td><td className="num">{kr(r.compensation)}</td><td className="num">{kr(r.fund)}</td><td className="num rf-left">{kr(r.left)}</td>
            <td>{r.deadline}{r.overdue && <span className="badge danger" style={{ marginLeft: '.3rem' }}>Ska återföras</span>}</td>
            <td>{!r.fund ? <form action={setFund.bind(null, company.id, r.id)} className="row"><input name="amount" defaultValue={(r.compensation / 100).toFixed(2).replace('.', ',')} aria-label="Avsättning" style={{ width: '8rem' }} /><button className="secondary small">Avsätt till fond</button></form>
              : r.left > 0 && <form action={useFund.bind(null, company.id, r.id)} className="row">
                <select name="action" aria-label="Åtgärd"><option value="use">Ta i anspråk (återanskaffning)</option><option value="reverse">Återför</option></select>
                <input name="amount" defaultValue={(r.left / 100).toFixed(2).replace('.', ',')} aria-label="Belopp" style={{ width: '8rem' }} /><input type="date" name="date" defaultValue={t} aria-label="Datum" /><button className="secondary small">Bokför</button></form>}</td></tr>))}
          {!rows.length && <tr><td colSpan={6} className="muted">Inga registrerade skador.</td></tr>}</tbody></table>
      <form action={addClaim.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Skadad tillgång<input name="description" required maxLength={200} placeholder="T.ex. Svarv, brand i verkstaden" /></label>
        <label>Typ<select name="kind"><option value="inventarier">Inventarier</option><option value="byggnad">Byggnad</option></select></label>
        <label>Skadedatum<input type="date" name="damage_date" defaultValue={t} required /></label>
        <label>Konto<input name="asset_account" placeholder="1220 / 1110" style={{ width: '6rem' }} /></label>
        <label>Bokfört värde (kr)<input name="book_value" style={{ width: '8rem' }} /></label>
        <label>Försäkringsersättning (kr)<input name="compensation" required style={{ width: '8rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Bokför skadan</button></div>
      </form>
    </div>
  );
}
