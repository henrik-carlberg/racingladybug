import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { annualReport } from '@/lib/services/taxreports';
import { Flash, type SP } from '@/components/ui';
import { DocumentBody } from '@/components/DocumentBody';
import { PrintButton } from '@/components/PrintButton';
import { today } from '@/lib/format';
import { minutes, saveReport } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function AnnualReport({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const r = await annualReport(company.id, Number(fyid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const ab = company.company_type === 'AB';
  const b = `/c/${company.id}/bokslut/${fyid}`;
  return (
    <div style={{ maxWidth: 900 }}>
      <div className="header no-print">
        <h1>{ab ? 'Årsredovisning' : 'Förenklat årsbokslut'}</h1>
        <div className="actions" style={{ margin: 0 }}><PrintButton />{ab && <a className="btn secondary" href={`${b}/arsredovisning/ixbrl`} download title="För digital inlämning till Bolagsverket">Ladda ner iXBRL</a>}<Link className="btn secondary" href={b}>Tillbaka</Link></div>
      </div>
      <Flash searchParams={searchParams} />
      {ab && (
        <div className="no-print">
          <form action={saveReport.bind(null, company.id, Number(fyid))} className="card stack">
            <b>Uppgifter till årsredovisningen</b>
            <label>Verksamheten (vad bolaget gör och var det har sitt säte)<textarea name="activity" rows={3} defaultValue={r.data.activity} placeholder={`Bolaget bedriver konsultverksamhet inom … Bolaget har sitt säte i ${company.city || '…'}.`} /></label>
            <label>Väsentliga händelser under året (valfritt)<textarea name="events" rows={2} defaultValue={r.data.events} /></label>
            <div className="row">
              <label>Föreslagen utdelning (kr)<input name="dividend" defaultValue={r.data.dividend ? String(r.data.dividend / 100) : ''} placeholder="0" inputMode="decimal" /></label>
              <label>Ort för underskrift<input name="place" defaultValue={r.data.place ?? company.city} /></label>
            </div>
            <label>Styrelse och VD – en per rad: Namn, roll<textarea name="board" rows={3} defaultValue={(r.data.board ?? []).map((x) => `${x.name}, ${x.role}`).join('\n')} placeholder={'Anna Andersson, Styrelseledamot\nBo Berg, Styrelsesuppleant'} /></label>
            <label className="check"><input type="checkbox" name="auditor" defaultChecked={r.data.auditorWaived === false} /> Bolaget har revisor</label>
            <div><button className="secondary">Spara och uppdatera utkastet</button></div>
          </form>
          <div className="card small">
            <b>Så går du vidare</b>
            <ol style={{ marginBottom: 0 }}>
              <li>Granska utkastet nedan och skriv ut/spara som PDF. Alla styrelseledamöter (och VD) ska skriva under – för hand, eller digitalt med avancerad e-signatur (BankID) i Bolagsverkets e-tjänst.</li>
              <li>Håll årsstämma inom sex månader efter räkenskapsårets slut. Skapa protokollet här nedan och låt justeraren signera digitalt.</li>
              <li>Skicka in årsredovisningen med fastställelseintyget till Bolagsverket inom sju månader (digitalt via Bolagsverkets e-tjänst eller per post). Annars tas förseningsavgift ut.</li>
            </ol>
          </div>
          <form action={minutes.bind(null, company.id, Number(fyid))} className="card stack">
            <b>Årsstämmoprotokoll</b>
            <div className="row">
              <label>Stämmans datum<input type="date" name="date" defaultValue={today()} required /></label>
              <label>Plats<input name="place" defaultValue={company.city} /></label>
            </div>
            <label>Justerare / övriga närvarande aktieägare – en per rad: Namn, e-post (valfritt)<textarea name="co_signers" rows={2} placeholder="Bo Berg, bo@example.com" /></label>
            <div><button className="secondary">Skapa protokoll och skicka för e-signering</button></div>
            <p className="small muted" style={{ margin: 0 }}>Protokollet fylls i med resultat och styrelsens förslag till disposition. Du signerar som ordförande; justerare får en länk.</p>
          </form>
        </div>
      )}
      {ab && <p className="small muted no-print">iXBRL-filen innehåller årsredovisningen med siffrorna märkta enligt Bolagsverkets taxonomi, för digital inlämning. Kontrollera filen i Bolagsverkets testtjänst första gången innan du lämnar in den.</p>}
      {!ab && <p className="small muted no-print">Det förenklade årsbokslutet innehåller resultat- och balansräkning (BFL 6:6). Skriv ut, signera och spara det med räkenskapsinformationen i sju år.</p>}
      <DocumentBody kind="html" html={r.html} pdfUrl="" filename={null} />
    </div>
  );
}
