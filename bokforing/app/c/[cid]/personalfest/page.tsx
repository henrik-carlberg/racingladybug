import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { overview } from '@/lib/services/staff-events';
import { register } from './actions';

export const dynamic = 'force-dynamic';

/** Personalfester och intern representation */
export default async function StaffEvents({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const year = Number(today().slice(0, 4));
  const o = await overview(company.id, year);
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Personalfester</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Högst två personalfester per år är skattefria för de anställda, om kostnaden är rimlig. Momsen på mat och dryck får dras av för högst 300 kr exkl. moms per person.
        Måltiden är inte avdragsgill vid inkomstbeskattningen; övriga kostnader som lokal och underhållning dras av med högst 180 kr exkl. moms per person.
        Den ej avdragsgilla delen bokas på 7632 och läggs till i deklarationen.</p>
      <div className="grid">
        <div className="card stat"><div className="label">Personalfester {year}</div><div className="value pf-count">{o.events.length}</div></div>
        <div className="card stat"><div className="label">Ej avdragsgillt {year}</div><div className="value pf-nonded">{kr(o.nonDeductible)}</div></div>
      </div>
      <table className="pf-list"><tbody>{o.events.map((e) => <tr key={e.id} className="pf-row"><td>{e.date}</td><td>{e.title}</td><td>{e.persons} deltagare</td><td className="num">{kr(e.total)}</td>
        <td className="small">{e.warnings && <span style={{ color: 'var(--warn)' }}>⚠️ {e.warnings}</span>}</td></tr>)}</tbody></table>
      <form action={register.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <div className="row">
          <label>Tillfälle<input name="title" required maxLength={200} placeholder="T.ex. julfest" /></label>
          <label>Datum<input type="date" name="date" defaultValue={today()} /></label>
          <label>Deltagare<input name="persons" required style={{ width: '6rem' }} /></label>
          <label>Ert riktvärde per person inkl. moms (kr)<input name="guideline" style={{ width: '8rem' }} /></label>
        </div>
        <div className="row">
          <label>Mat och dryck exkl. moms (kr)<input name="meal" /></label><label>Moms på mat och dryck (kr)<input name="meal_vat" /></label>
          <label>Lokal, underhållning m.m. exkl. moms (kr)<input name="other" /></label><label>Moms på övrigt (kr)<input name="other_vat" /></label>
        </div>
        <div><button>Bokför personalfest</button></div>
      </form>
    </div>
  );
}
