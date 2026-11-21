import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { LOW_VALUE_MARKUP, METHOD_LABEL, TYPE_LABEL } from '@/lib/transfer-pricing';
import { overview } from '@/lib/services/transfer-pricing';
import { addTransaction, documentTransaction } from './actions';

export const dynamic = 'force-dynamic';

/** Internprissättning: koncerninterna transaktioner, marknadsmässighet och dokumentation */
export default async function TransferPricing({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const sp = await searchParams;
  const year = /^\d{4}$/.test(String(sp.year)) ? Number(sp.year) : Number(today().slice(0, 4));
  const o = await overview(company.id, year);
  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>Internprissättning {year}</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Priser mellan företag i samma koncern ska vara marknadsmässiga (armlängdsprincipen). Gränsöverskridande transaktioner ska dokumenteras när de uppgår till 5 miljoner kronor per år med en part,
        och alltid för immateriella tillgångar. Mindre företag får dokumentera förenklat. Stödtjänster med lågt mervärde prissätts normalt med {LOW_VALUE_MARKUP} % påslag.</p>
      <div className="grid"><div className="card stat"><div className="label">Avvikelser att åtgärda</div><div className="value tp-errors">{o.errors}</div></div></div>
      <table className="tp-list"><thead><tr><th>Motpart</th><th>Typ</th><th className="num">Belopp</th><th>Metod</th><th>Villkor</th><th>Kontroll</th></tr></thead>
        <tbody>{o.rows.map((r) => (
          <tr key={r.id} className="tp-row" data-counterparty={r.counterparty}>
            <td>{r.counterparty} <span className="small muted">{r.country}</span>{r.description && <div className="small muted">{r.description}</div>}</td><td>{r.typeLabel}</td><td className="num">{kr(r.amount)}</td><td className="small">{r.methodLabel}</td>
            <td className="small">{r.rate_pct != null && `ränta ${r.rate_pct} %`}{r.markup_pct != null && `påslag ${r.markup_pct} %`}{(r.range_min != null || r.range_max != null) && ` (intervall ${r.range_min ?? '–'}–${r.range_max ?? '–'} %)`}</td>
            <td>{r.warnings.length ? <ul className="small tp-warnings" style={{ margin: 0, paddingLeft: '1rem' }}>{r.warnings.map((w) => <li key={w.text} className={w.level}>{w.level === 'error' ? '⚠️' : 'ℹ️'} {w.text}</li>)}</ul> : <span className="badge ok">OK</span>}
              {r.documented ? <div className="small muted tp-doc">Dokumenterad: {r.documentation}</div>
                : r.needsDoc && <form action={documentTransaction.bind(null, company.id, r.id, year)} className="row"><input name="documentation" placeholder="Var dokumentationen finns, jämförelser, analys" aria-label="Dokumentation" style={{ width: '16rem' }} /><button className="secondary small">Spara</button></form>}</td></tr>))}
          {!o.rows.length && <tr><td colSpan={6} className="muted">Inga koncerninterna transaktioner registrerade för året.</td></tr>}</tbody></table>
      <form action={addTransaction.bind(null, company.id)} className="card stack" style={{ marginTop: '1rem' }}>
        <input type="hidden" name="year" value={year} />
        <div className="row">
          <label>Motpart<input name="counterparty" required list="tp-group" /></label>
          <datalist id="tp-group">{o.group.map((g) => <option key={g} value={g} />)}</datalist>
          <label>Land<input name="country" defaultValue="SE" maxLength={2} style={{ width: '4rem' }} /></label>
          <label>Typ<select name="type">{Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Årets belopp (kr)<input name="amount" required style={{ width: '9rem' }} /></label>
          <label>Prismetod<select name="method">{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <div className="row">
          <label>Påslag %<input name="markup_pct" style={{ width: '5rem' }} /></label>
          <label>Ränta %<input name="rate_pct" style={{ width: '5rem' }} /></label>
          <label>Marknadsmässigt intervall från %<input name="range_min" style={{ width: '5rem' }} /></label>
          <label>till %<input name="range_max" style={{ width: '5rem' }} /></label>
          <label className="row" style={{ alignItems: 'center' }}><input type="checkbox" name="low_value" /> Stödtjänst med lågt mervärde</label>
          <label>Beskrivning<input name="description" maxLength={300} /></label>
        </div>
        <button>Registrera transaktion</button>
      </form>
    </div>
  );
}
