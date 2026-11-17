import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { siePreview } from '@/lib/services/sie-import';
import { run, upload } from './actions';

export const dynamic = 'force-dynamic';

export default async function SieImport({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { owner: true });
  const sp = await searchParams;
  const b = `/c/${company.id}`;
  const p = Number(sp.id) ? await siePreview(company.id, Number(sp.id)).catch(() => null) : null;
  const digits = (s: string) => s.replace(/\D/g, '');
  const ib = p ? Object.entries(p.file.openingBalances[0] ?? {}).filter(([a, v]) => Number(a) < 3000 && v !== 0) : [];
  const assets = ib.filter(([a]) => Number(a) < 2000).reduce((s, [, v]) => s + v, 0);
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Importera SIE-fil</h1>
      <Flash searchParams={searchParams} />
      {!p || p.status === 'imported' ? (
        <>
          {p?.status === 'imported' && p.result && (
            <div className="card"><b>{p.filename}</b> är importerad: {p.result.accounts} nya konton{p.result.opening ? ', ingående balanser' : ''} och {p.result.vouchers} verifikationer.{' '}
              <Link href={`${b}/verifikationer`}>Visa verifikationer</Link> · <Link href={`${b}/rapporter`}>Rapporter</Link></div>
          )}
          <p className="muted">Flytta över bokföringen från ett annat program. Exportera en SIE-fil (typ 4 innehåller verifikationer, typ 1–3 bara saldon) från det gamla programmet, t.ex. Fortnox, Visma eller Bokio, och ladda upp den här. Du får se vad filen innehåller innan något bokförs.</p>
          <form action={upload.bind(null, company.id)} className="card stack">
            <label>SIE-fil (.se, .si, .sie)<input type="file" name="file" accept=".se,.si,.sie,.txt" required /></label>
            <div><button>Läs in och förhandsgranska</button></div>
          </form>
        </>
      ) : (
        <>
          <div className="card">
            <b>{p.filename}</b>
            <table className="small"><tbody>
              <tr><td>Företag i filen</td><td>{p.file.companyName} {p.file.orgnr}
                {p.file.orgnr && digits(p.file.orgnr) !== digits(company.orgnr) && <span className="badge warn" style={{ marginLeft: '.4rem' }}>Annat org.nr än {company.orgnr}</span>}</td></tr>
              <tr><td>Program</td><td>{p.file.program || '–'} (SIE typ {p.file.sieType || '?'})</td></tr>
              <tr><td>Räkenskapsår</td><td>{p.year ? `${p.year.start} – ${p.year.end}` : '–'}{p.year && !p.fiscalYearId && !p.overlap && <span className="muted"> (läggs upp vid import)</span>}</td></tr>
              <tr><td>Konton</td><td>{p.file.accounts.length} i filen, {p.newAccounts.length} nya</td></tr>
              <tr><td>Ingående balanser</td><td>{ib.length} konton, tillgångar {kr(assets)} kr{p.hasOpeningBalance && <span className="muted"> – redan registrerade för året</span>}</td></tr>
              <tr><td>Verifikationer</td><td>{p.file.vouchers.length} {Object.keys(p.series).length > 0 && `(${Object.entries(p.series).map(([s, n]) => `serie ${s}: ${n}`).join(', ')})`}
                {p.existingVouchers > 0 && <span className="muted"> – året har redan {p.existingVouchers} verifikationer</span>}</td></tr>
            </tbody></table>
          </div>
          {p.problems.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--danger)' }}>
              <b>Filen har fel och kan bara användas för kontoplanen</b>
              <ul className="small">{p.problems.slice(0, 20).map((e) => <li key={e}>{e}</li>)}{p.problems.length > 20 && <li>… och {p.problems.length - 20} till</li>}</ul>
            </div>
          )}
          {p.file.warnings.length > 0 && <p className="small muted">Varningar: {p.file.warnings.slice(0, 5).join('; ')}</p>}
          <form action={run.bind(null, company.id, p.id)} className="card stack">
            <label className="check"><input type="checkbox" name="accounts" defaultChecked={p.newAccounts.length > 0} /> Lägg till {p.newAccounts.length} nya konton i kontoplanen</label>
            <label className="check"><input type="checkbox" name="opening" defaultChecked={!p.hasOpeningBalance && ib.length > 0 && !p.problems.length} disabled={p.hasOpeningBalance || !ib.length || p.problems.length > 0} /> Bokför ingående balanser</label>
            <label className="check"><input type="checkbox" name="vouchers" defaultChecked={p.existingVouchers === 0 && p.file.vouchers.length > 0 && !p.problems.length} disabled={p.existingVouchers > 0 || !p.file.vouchers.length || p.problems.length > 0} /> Importera {p.file.vouchers.length} verifikationer</label>
            <p className="small muted" style={{ margin: 0 }}>Verifikationerna får nya nummer i sina serier och originalnumret står i texten. Importen görs i ett svep – blir något fel bokförs ingenting. Importerade verifikationer kan bara rättas med rättelseverifikationer.</p>
            <div className="actions" style={{ margin: 0 }}><button>Importera</button><Link className="btn secondary" href={`${b}/kom-igang/sie-import`}>Välj en annan fil</Link></div>
          </form>
        </>
      )}
    </div>
  );
}
