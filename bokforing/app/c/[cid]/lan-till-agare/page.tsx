import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { RELATION_LABEL } from '@/lib/owner-loans';
import { overview } from '@/lib/services/owner-loans';
import { addLoan, settleLoan } from './actions';

export const dynamic = 'force-dynamic';

/** Lån till ägare, styrelse och närstående – låneförbudet och skattekonsekvensen */
export default async function OwnerLoans({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const o = await overview(company.id);
  const t = today();
  return (
    <div style={{ maxWidth: 1000 }}>
      <h1>Lån till ägare och närstående</h1>
      <Flash searchParams={searchParams} />
      <p className="small">Ett aktiebolag får inte låna ut pengar till aktieägare, styrelseledamöter, verkställande direktör eller deras närstående, eller till företag som de bestämmer över (aktiebolagslagen 21 kap.).
        Undantag är koncernlån och lån till en juridisk person för dess näringsverksamhet på affärsmässiga grunder.{o.closelyHeld && ' I ett fåmansföretag beskattas ett förbjudet lån som lön hos låntagaren.'}</p>
      <div className="grid">
        <div className="card stat"><div className="label">Förbjudna lån, utestående</div><div className="value ol-prohibited">{kr(o.prohibited)}</div></div>
        <div className="card stat"><div className="label">Saldo 1685 utan registrerat lån</div><div className="value ol-unregistered">{kr(o.unregistered)}</div></div>
        <div className="card stat"><div className="label">Beslutad utdelning att kvitta mot (2898)</div><div className="value">{kr(o.dividendDebt)}</div></div>
      </div>
      <table className="ol-loans"><thead><tr><th>Låntagare</th><th>Förhållande</th><th>Datum</th><th className="num">Utestående</th><th>Bedömning</th><th></th></tr></thead>
        <tbody>{o.rows.map((r) => (
          <tr key={r.id} className={`ol-row ${r.prohibited ? 'prohibited' : ''}`} data-borrower={r.borrower}>
            <td>{r.borrower}</td><td className="small">{r.label}{r.relation === 'related_company' ? ` (${r.purpose === 'business' ? 'näringsverksamhet' : 'privat'})` : ''}</td><td>{r.loan_date}</td><td className="num">{kr(r.outstanding)}</td>
            <td>{r.prohibited ? <span className="badge danger">Förbjudet</span> : <span className="badge ok">Tillåtet</span>} <span className="small">{r.reason}</span>{r.consequence && <div className="small ol-consequence">{r.consequence}</div>}</td>
            <td>{r.outstanding > 0 && <form action={settleLoan.bind(null, company.id, r.id)} className="row">
              <select name="kind" aria-label="Hur"><option value="repay">Återbetalning</option><option value="dividend">Kvitta mot utdelning</option></select>
              <input name="amount" defaultValue={(r.outstanding / 100).toFixed(2).replace('.', ',')} aria-label="Belopp" style={{ width: '8rem' }} />
              <input type="date" name="date" defaultValue={t} aria-label="Datum" /><button className="secondary small">Reglera</button></form>}</td></tr>))}
          {!o.rows.length && <tr><td colSpan={6} className="muted">Inga registrerade lån.</td></tr>}</tbody></table>
      <form action={addLoan.bind(null, company.id)} className="card row" style={{ marginTop: '1rem' }}>
        <label>Låntagare<input name="borrower" required maxLength={200} /></label>
        <label>Förhållande till bolaget<select name="relation">{Object.entries(RELATION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>Syfte<select name="purpose"><option value="private">Privat</option><option value="business">Låntagarens näringsverksamhet</option></select></label>
        <label>Datum<input type="date" name="loan_date" defaultValue={t} required /></label>
        <label>Belopp (kr)<input name="amount" required style={{ width: '8rem' }} /></label>
        <label>Konto<input name="account" defaultValue="1685" style={{ width: '5rem' }} /></label>
        <div style={{ flex: '0 0 auto' }}><button>Registrera lån</button></div>
      </form>
    </div>
  );
}
