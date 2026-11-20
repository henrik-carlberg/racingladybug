import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { VoucherForm } from '@/components/VoucherForm';
import { listCostCenters, listProjectRefs } from '@/lib/services/dimensions';
import { saveVoucher } from '../actions';
import { today } from '@/lib/format';
import { Help } from '@/components/Help';
import { getVoucher } from '@/lib/services/vouchers';
import { companyPeriod } from '@/lib/services/period';
import { aiEnabled, getVoucherSuggestion } from '@/lib/services/ai-bookkeeping';
import { aiVoucher } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewVoucher({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: Promise<{ kopiera?: string; ai?: string; error?: string }> }) {
  const { cid } = await params;
  const { company, aiAccess } = await requireCompany(cid, { perm: 'ledger' });
  // "Bokför igen": samma beskrivning, konton och belopp som en tidigare verifikation i bolaget
  const copyId = Number((await searchParams).kopiera);
  const copy = Number.isInteger(copyId) && copyId > 0 ? await getVoucher(company.id, copyId).catch(() => null) : null;
  const sp = await searchParams;
  const ai = sp.ai ? await getVoucherSuggestion(company.id, Number(sp.ai)) : null;
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active ORDER BY number`;
  return (
    <>
      <h1>Ny verifikation <Help term="verifikation" /> <Help term="debet_kredit" /></h1>
      <p className="muted small">Tips: för vanliga kvitton är det enklare att använda <a href={`/c/${company.id}/kvitto`}>Nytt kvitto</a> – då väljer appen konton åt dig.</p>
      {sp.error && <div className="flash error" role="alert">{sp.error}</div>}
      {aiEnabled() && aiAccess && !ai && (
        <form action={aiVoucher.bind(null, company.id)} className="card stack ai-box" id="ai">
          <label><b>✨ Beskriv vad som har hänt</b> – så föreslår appen verifikationen
            <textarea name="text" rows={2} required placeholder="T.ex. Betalade 450 kr för parkering med företagskortet i går" /></label>
          <div><button className="secondary">Föreslå verifikation</button></div>
        </form>
      )}
      {ai && (
        <div className={`card ai-box ${ai.problems.length ? 'warn' : ''}`} role="status">
          <div className="small muted">Du skrev: ”{ai.input}”</div>
          <div style={{ margin: '.3rem 0' }}>✨ {ai.explanation} {ai.confidence !== 'high' && <span className="badge warn">{ai.confidence === 'medium' ? 'Kontrollera' : 'Osäker – kontrollera noga'}</span>}</div>
          {ai.problems.map((p) => <div key={p} className="check-item warn small">{p}</div>)}
          <div className="small muted">Inget är bokfört än. Kontrollera raderna och tryck Bokför.</div>
        </div>
      )}
      {copy && <div className="learned small" role="status">✨ Ifyllt som verifikation {copy.series}{copy.number} ({copy.date}). Kontrollera datum och belopp innan du bokför.</div>}
      <VoucherForm key={ai ? `ai${sp.ai}` : copy ? `c${copy.id}` : 'ny'} period={await companyPeriod(company.id)} initial={ai ? { date: ai.date, description: ai.description, rows: ai.lines } : copy ? { description: copy.description, rows: copy.lines } : undefined} action={saveVoucher.bind(null, company.id)} accounts={[...accounts]} today={today()}
        costCenters={await listCostCenters(company.id, true)} projects={await listProjectRefs(company.id, true)} />
    </>
  );
}
