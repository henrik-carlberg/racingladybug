import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { taxForms } from '@/lib/services/taxreports';
import { ink2Due, nextWorkingDay } from '@/lib/deadlines';
import { FormTable } from '@/components/FormTable';
import { PrintButton } from '@/components/PrintButton';
import { kr } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TaxReturn({ params }: { params: Promise<{ cid: string; fyid: string }> }) {
  const { cid, fyid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  // Handels- och kommanditbolag: INK4 och delägarnas N3B finns under Delägare
  if (company.company_type === 'HB' || company.company_type === 'KB') redirect(`/c/${company.id}/delagare?fy=${encodeURIComponent(fyid)}`);
  const f = await taxForms(company.id, Number(fyid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const b = `/c/${company.id}/bokslut/${f.fy.id}`;
  const unmapped = f.type === 'AB' ? f.ink2.unmapped : f.ne.unmapped;
  return (
    <div style={{ maxWidth: 980 }}>
      <div className="header no-print">
        <h1>{f.type === 'AB' ? 'Inkomstdeklaration 2' : 'NE-bilaga'} {f.fy.start_date} – {f.fy.end_date}</h1>
        <div className="actions" style={{ margin: 0 }}><PrintButton label="Skriv ut" /><Link className="btn secondary" href={b}>Tillbaka</Link></div>
      </div>
      <div className="card no-print">
        <b>Så här lämnar du deklarationen</b>
        {f.type === 'AB' ? (
          <ol className="small" style={{ marginBottom: 0 }}>
            <li>Kontrollera beloppen nedan (de bygger på bokföringen – gör bokslutet först).</li>
            <li>Ladda ner båda SRU-filerna: <a href={`${b}/sru/INFO.SRU`}>INFO.SRU</a> och <a href={`${b}/sru/BLANKETTER.SRU`}>BLANKETTER.SRU</a>.</li>
            <li>Logga in med BankID på Skatteverkets <b>Filöverföring</b>, ladda upp filerna, granska och signera. Alternativt fyll i rutorna manuellt i e-tjänsten <i>Inkomstdeklaration 2, 3 och 4</i>.</li>
            <li>Senast <b>{ink2Due(f.fy.end_date)}</b> (elektroniskt). Glöm inte att årsredovisningen ska bifogas digitalt eller skickas till Bolagsverket.</li>
          </ol>
        ) : (
          <ol className="small" style={{ marginBottom: 0 }}>
            <li>Kontrollera beloppen nedan (de bygger på bokföringen – gör årsbokslutet först).</li>
            <li>Fyll i NE-bilagan i din inkomstdeklaration på Skatteverkets e-tjänst, eller ladda upp SRU-filerna (<a href={`${b}/sru/INFO.SRU`}>INFO.SRU</a>, <a href={`${b}/sru/BLANKETTER.SRU`}>BLANKETTER.SRU</a>) via Filöverföring.</li>
            <li>Rutorna R12–R48 på sidan 2 (egenavgifter, periodiseringsfond, räntefördelning m.m.) fyller du i själv eller med din redovisningskonsult – Skatteverkets e-tjänst räknar fram flera av dem.</li>
            <li>Senast <b>{nextWorkingDay(`${Number(f.fy.end_date.slice(0, 4)) + 1}-05-02`)}</b>.</li>
          </ol>
        )}
      </div>
      {f.type === 'AB' && f.ink2.warnings.map((w) => <div key={w} className="flash error">{w}</div>)}
      {unmapped.length > 0 && <div className="flash error">Konton som inte kunde placeras i någon ruta: {unmapped.join(', ')}. Kontrollera dem med din redovisningskonsult.</div>}
      <p className="small muted">Mappningen följer BAS SRU-koder och Skatteverkets fältkoder för beskattningsperiod {f.period}. Belopp avrundas till hela kronor. Det här är ett underlag – granska alltid innan du skickar in.</p>
      {f.type === 'AB' ? (
        <>
          <div className="grid">
            <div className="card stat"><div className="label">Bokfört resultat</div><div className="value">{kr(f.ink2.result)}</div></div>
            <div className="card stat"><div className="label">{f.ink2.taxable >= 0 ? 'Skattemässigt överskott (1.1)' : 'Underskott (1.2)'}</div><div className="value">{kr(Math.abs(f.ink2.taxable))}</div></div>
          </div>
          <FormTable title="INK2 sidan 1" fields={f.ink2.page1} />
          <FormTable title="INK2R Räkenskapsschema – Resultaträkning" fields={f.ink2.income} />
          <FormTable title="INK2R Räkenskapsschema – Balansräkning" fields={f.ink2.balance} />
          <FormTable title="INK2S Skattemässiga justeringar" fields={f.ink2.adjustments} />
        </>
      ) : (
        <>
          <FormTable title="NE – Resultaträkning (R1–R11)" fields={f.ne.income} hideZero={false} />
          <FormTable title="NE – Balansräkning (B1–B16)" fields={f.ne.balance} />
          <FormTable title="NE – Skattemässiga justeringar" fields={f.ne.adjustments} />
        </>
      )}
    </div>
  );
}
