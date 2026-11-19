import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { kr } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import { migrationCheck } from '@/lib/services/migration';
import type { BalanceRow } from '@/lib/migration-check';

export const dynamic = 'force-dynamic';

function Table({ title, rows, ok, diffs, expectedLabel }: { title: string; rows: BalanceRow[]; ok: number; diffs: number; expectedLabel: string }) {
  return (
    <section className="card">
      <div className="header" style={{ marginBottom: '.5rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {diffs === 0 ? <span className="badge ok">✓ Alla {ok} konton stämmer</span> : <span className="badge danger">{diffs} {diffs === 1 ? 'konto avviker' : 'konton avviker'}</span>}
      </div>
      {rows.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Konto</th><th className="num">{expectedLabel}</th><th className="num">Här</th><th className="num">Skillnad</th></tr></thead>
          <tbody>{rows.slice(0, diffs ? Math.max(diffs, 10) : 10).map((r) => (
            <tr key={r.account} className={r.diff ? 'diff' : ''}><td>{r.account} {r.name}</td><td className="num">{kr(r.expected)}</td><td className="num">{kr(r.actual)}</td>
              <td className="num" style={r.diff ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{r.diff ? kr(r.diff) : '✓'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {rows.length > 10 && diffs < 10 && <p className="small muted">{rows.length - Math.max(diffs, 10)} konton till stämmer och visas inte.</p>}
    </section>
  );
}

export default async function MoveCheck({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const b = `/c/${company.id}`;
  const { sie, ledgers } = await migrationCheck(company.id);
  const ledgerRow = (label: string, x: { open: number; ledger: number; count: number }, account: string) => {
    const diff = x.ledger - x.open;
    return (
      <tr><td>{label} ({x.count} st)</td><td className="num">{kr(x.open)}</td><td className="num">{kr(x.ledger)} <span className="small muted">({account})</span></td>
        <td className="num" style={diff ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{diff ? kr(diff) : '✓'}</td></tr>
    );
  };
  return (
    <div style={{ maxWidth: 960 }}>
      <div className="header"><h1>Kontroll efter flytten</h1><Link className="btn secondary" href={`${b}/kom-igang/flytt`}>Tillbaka till guiden</Link></div>
      {!sie ? <EmptyState icon="ledger" title="Ingen SIE-fil är importerad" actions={[{ href: `${b}/kom-igang/sie-import`, label: 'Importera SIE-fil' }]}>Kontrollen jämför saldona i filen från ditt gamla program med bokföringen här.</EmptyState> : (
        <>
          <p className="muted">Räkenskapsåret {sie.year.start} – {sie.year.end}. Saldona i filen från det gamla programmet jämförs med bokföringen här.</p>
          <Table title="Ingående balanser" {...sie.opening} expectedLabel="I filen (#IB)" />
          {sie.closing ? <Table title="Utgående saldon" {...sie.closing} expectedLabel="I filen (#UB)" /> : <div className="card small">{sie.hasVouchers ? 'Filen innehåller inga utgående saldon (#UB)' : 'Filen innehöll inga verifikationer'}, så bara de ingående balanserna jämförs.</div>}
          {sie.result && <Table title="Resultat per konto" {...sie.result} expectedLabel="I filen (#RES)" />}
        </>
      )}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Obetalda fakturor mot bokföringen</h2>
        <div className="table-wrap"><table>
          <thead><tr><th></th><th className="num">Obetalda fakturor</th><th className="num">I bokföringen</th><th className="num">Skillnad</th></tr></thead>
          <tbody>
            {ledgerRow('Kundfakturor', ledgers.ar, 'kundfordringar 1510')}
            {ledgerRow('Leverantörsfakturor', ledgers.ap, 'leverantörsskulder 2440')}
          </tbody>
        </table></div>
        <p className="small muted" style={{ margin: 0 }}>Om det skiljer: kontrollera att alla obetalda fakturor är importerade och att de ingående saldona på 1510 och 2440 stämmer. Fakturor i utländsk valuta räknas inte med i kundfakturorna.</p>
      </section>
    </div>
  );
}
