import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/server/auth';
import { NotFoundError } from '@/lib/errors';
import { yearStatus, CORPORATE_TAX_RATE } from '@/lib/services/yearend';
import { ink2Due, nextWorkingDay } from '@/lib/deadlines';
import { Flash, type SP } from '@/components/ui';
import { Help } from '@/components/Help';
import { kr } from '@/lib/format';
import { carry, close, openInvoices, tax } from '../actions';

export const dynamic = 'force-dynamic';

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="card" style={done ? { opacity: 0.7 } : undefined}>
      <h2 style={{ margin: '0 0 .5rem', fontSize: '1.05rem' }}>{done ? '✅' : `${n}.`} {title}</h2>
      {children}
    </div>
  );
}

export default async function YearendYear({ params, searchParams }: { params: Promise<{ cid: string; fyid: string }>; searchParams: SP }) {
  const { cid, fyid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const s = await yearStatus(company.id, Number(fyid)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const b = `/c/${company.id}`;
  const ab = s.companyType === 'AB';
  const y = Number(s.fy.end_date.slice(0, 4));
  const ended = s.fy.end_date < new Date().toISOString().slice(0, 10);
  const issues = [
    s.cashOpenInvoices && `${s.cashOpenInvoices} obetalda fakturor ska bokföras per ${s.fy.end_date} (kontantmetoden)`,
    s.unreconciledBank && `${s.unreconciledBank} banktransaktioner är inte avstämda`,
    s.draftInvoices && `${s.draftInvoices} fakturautkast är inte bokförda`,
    s.unpaidSupplierInvoicesWithoutApproval && `${s.unpaidSupplierInvoicesWithoutApproval} leverantörsfakturor väntar på attest`,
    s.vatUnsettled && 'Momsen för årets sista period är inte avräknad',
  ].filter(Boolean) as string[];
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Bokslut {s.fy.start_date} – {s.fy.end_date} <Help term="bokslut" /></h1>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Resultat före skatt</div><div className="value">{kr(s.resultBeforeTax)}</div></div>
        {ab && <div className="card stat"><div className="label">Bokförd skatt</div><div className="value">{kr(s.taxBooked)}</div></div>}
        <div className="card stat"><div className="label">Årets resultat <Help term="arets_resultat" /></div><div className="value">{kr(s.resultAfterTax)}</div></div>
      </div>
      {s.companyType === 'EF' && <p className="small"><Link href={`${b}/bokslut/${s.fy.id}/ne-planering`}>Skatteplanering NE</Link> – räntefördelning, periodiseringsfond och expansionsfond med förslag som ger lägst skatt.</p>}
      <p className="small"><Link href={`${b}/bokslut/${s.fy.id}/kassaflode`}>Kassaflödesanalys</Link> per månad och år · <Link href={`${b}/bokslut/${s.fy.id}/k3`}>Regelverk K2/K3</Link> – byte till K3, uppskjuten skatt och utökade noter.</p>
      {s.companyType === 'EF' && <p className="small"><Link href={`${b}/ombildning`}>Ombildning till aktiebolag</Link> – för över verksamheten till ditt aktiebolag till bokfört värde och gör den slutliga NE-bilagan.</p>}
      {ab && <p className="small"><Link href={`${b}/bokslut/ranteavdrag`}>Ränteavdragsbegränsning</Link> – EBITDA-regeln, förenklingsregeln och sparat negativt räntenetto.</p>}
      {ab && <p className="small"><Link href={`${b}/bokslut/underskott`}>Underskottsavdrag</Link> – rullande underskott med belopps- och koncernbidragsspärr vid ägarförändring.</p>}
      {ab && <p className="small"><Link href={`${b}/kontrollbalans`}>Kontrollbalansräkning</Link> – kapitalbrist, kontrollstämmor och likvidation.</p>}
      <p className="small"><Link href={`${b}/bokslut/${s.fy.id}/avsattningar`}>Avsättningar och åtaganden</Link> – garantiavsättningar, ställda säkerheter och eventualförpliktelser till noterna.</p>
      <p className="small"><Link href={`${b}/bokslut/${s.fy.id}/kundforluster`}>Kundförluster</Link> – reserv för befarade förluster på förfallna och inkasserade fakturor.</p>
      <p className="small"><Link href={`${b}/bokslut/${s.fy.id}/kontroller`}>Kontroller före bokslut</Link> – ovanliga saldon, gamla avräkningskonton och momsavvikelser med förslag på åtgärd.</p>
      <p className="small"><Link href={`${b}/bokslut/${s.fy.id}/parm`}>Bokslutspärm</Link> – specifikation och avstämning per balanskonto, som PDF till revisor och bank.</p>
      <p className="small"><Link href={`${b}/bokslut/${s.fy.id}/dispositioner`}>Bokslutsdispositioner</Link> – periodiseringsfond, överavskrivningar och koncernbidrag som sänker skatten (gör dem före skatten).</p>
      {!ended && <div className="flash ok">Räkenskapsåret pågår till {s.fy.end_date}. Du kan förbereda bokslutet, men vänta med att stänga året tills det är slut.</div>}

      <Step n={1} title="Stäm av och bokför allt för året" done={issues.length === 0}>
        {issues.length ? <ul className="small">{issues.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="small">Allt ser avstämt ut.</p>}
        {(s.accountingMethod === 'cash' || s.cashOpenInvoices > 0) && !s.fy.closed && (
          <div className="stack" style={{ margin: '.5rem 0' }}>
            <p className="small">Du använder <b>kontantmetoden</b> <Help term="kontantmetoden" />. Registrera först alla betalningar som kommit in eller gått ut till och med {s.fy.end_date}.
              Sedan bokförs de fakturor som fortfarande är obetalda per bokslutsdagen – gör det <b>innan</b> du bokför årets sista momsavräkning, eftersom momsen på dem hör till året.</p>
            {s.cashOpenInvoices > 0 && (
              <form action={openInvoices.bind(null, company.id, s.fy.id)}>
                <button className="secondary" disabled={!ended}>Bokför {s.cashOpenInvoices} obetalda fakturor per {s.fy.end_date}</button>
              </form>
            )}
          </div>
        )}
        <p className="small muted">Kontrollera också att bankens saldo per {s.fy.end_date} stämmer med konto 1930, att alla kvitton och fakturor för året är bokförda, och att
          kundfordringar och leverantörsskulder stämmer. <Link href={`${b}/bank`}>Bank</Link> · <Link href={`${b}/rapporter/moms`}>Moms</Link> · <Link href={`${b}/rapporter?fy=${s.fy.id}`}>Balansräkning</Link></p>
      </Step>

      <Step n={2} title="Bokslutsposter">
        <p className="small">Bokför vid behov som <Link href={`${b}/verifikationer/ny`}>ny verifikation</Link> daterad {s.fy.end_date}:</p>
        <ul className="small">
          <li><b>Avskrivningar</b> på inventarier över ett halvt prisbasbelopp – bokförs från <Link href={`${b}/anlaggningar`}>anläggningsregistret</Link>.</li>
          <li><b>Periodiseringar</b>: kostnader som betalats men gäller nästa år (1790) och kostnader som hör till året men inte fakturerats (2990) – lägg upp dem under <Link href={`${b}/periodiseringar`}>Periodiseringar</Link>.</li>
          <li><b>Lager</b>: inventera och justera lagerkontot.</li>
          {ab && <li><b>Semesterlöneskuld</b> och upplupna sociala avgifter om ni har anställda (2920/2940) – <Link href={`${b}/periodiseringar?asof=${s.fy.end_date}`}>beräkna och bokför förslaget</Link>.</li>}
          {ab && <li><b>Periodiseringsfond</b>: upp till 25 % av överskottet kan sättas av (8811/2110) – fråga gärna din redovisningskonsult.</li>}
        </ul>
      </Step>

      {ab && (
        <Step n={3} title={`Beräkna och bokför bolagsskatt (${String(CORPORATE_TAX_RATE).replace('.', ',')} %)`} done={s.taxBooked !== 0}>
          {s.taxBooked !== 0 ? <p className="small">Skatt {kr(s.taxBooked)} kr är bokförd.</p> : (
            <form action={tax.bind(null, company.id, s.fy.id)} className="row">
              <label>Skatt att bokföra (kr)<input name="amount" defaultValue={(s.suggestedTax / 100).toFixed(0)} inputMode="decimal" /></label>
              <div style={{ flex: '0 0 auto' }}><button className="secondary" disabled={s.suggestedTax <= 0}>Bokför skatt</button></div>
            </form>
          )}
          <p className="small muted">Förslaget = {CORPORATE_TAX_RATE} % × (resultat före skatt + ej avdragsgilla kostnader {kr(s.nonDeductible)} kr), avrundat nedåt. Slutlig skatt fastställs av Skatteverket utifrån deklarationen.</p>
        </Step>
      )}

      <Step n={ab ? 4 : 3} title="Bokför årets resultat och stäng året" done={s.fy.closed}>
        {s.fy.closed ? <p className="small">Året är stängt. Inga fler verifikationer kan bokföras på det.</p> : (
          <form action={close.bind(null, company.id, s.fy.id)} className="stack">
            <p className="small">Årets resultat {kr(s.resultAfterTax)} kr bokförs mot {ab ? '2099 Årets resultat' : s.companyType === 'HB' || s.companyType === 'KB' ? 'delägarnas konton för årets resultat (20x9) efter andel' : '2019 Årets resultat'} och räkenskapsåret stängs. Nästa räkenskapsår läggs upp automatiskt.</p>
            <div><button disabled={!ended}>Bokför resultat och stäng året</button></div>
          </form>
        )}
      </Step>

      <Step n={ab ? 5 : 4} title={ab ? 'Inkomstdeklaration 2 (INK2)' : s.companyType === 'HB' || s.companyType === 'KB' ? 'Inkomstdeklaration 4 och delägarnas N3B' : 'NE-bilaga till din inkomstdeklaration'}>
        <p className="small">Underlag med alla rutor ifyllda från bokföringen, och en SRU-fil som kan laddas upp via Skatteverkets filöverföring.
          Senast <b>{ab ? ink2Due(s.fy.end_date) : nextWorkingDay(`${y + 1}-05-02`)}</b>.</p>
        <Link className="btn" href={`${b}/bokslut/${s.fy.id}/deklaration`}>Öppna deklarationsunderlag</Link>
      </Step>

      <Step n={ab ? 6 : 5} title={ab ? 'Årsredovisning och årsstämma' : 'Årsbokslut'}>
        <p className="small">{ab
          ? 'Ett utkast till årsredovisning (K2) skapas från bokföringen. Komplettera verksamhetsbeskrivning och styrelse, håll årsstämma inom sex månader och skicka in till Bolagsverket inom sju månader.'
          : 'Ett förenklat årsbokslut (resultat- och balansräkning) skapas från bokföringen. Skriv ut, signera och spara det med räkenskapsinformationen.'}</p>
        <Link className="btn" href={`${b}/bokslut/${s.fy.id}/arsredovisning`}>{ab ? 'Öppna årsredovisning' : 'Öppna årsbokslut'}</Link>
      </Step>

      <Step n={ab ? 7 : 6} title={ab ? 'Efter årsstämman: resultatdisposition' : 'Nytt år: för över till eget kapital'}>
        <p className="small">{ab
          ? 'När årsstämman har beslutat om vinsten: för över förra årets resultat till balanserat resultat (2091) och bokför ev. utdelning som skuld (2898). Görs på det nya räkenskapsåret.'
          : 'Årets resultat, egna uttag och insättningar förs över till eget kapital (2010) på det nya räkenskapsårets första dag.'}</p>
        <form action={carry.bind(null, company.id, s.fy.id)} className="row">
          {ab && <label>Beslutad utdelning (kr)<input name="dividend" inputMode="decimal" placeholder="0" /></label>}
          <div style={{ flex: '0 0 auto' }}><button className="secondary">Bokför på detta år ({s.fy.start_date})</button></div>
        </form>
        <p className="small muted">Görs på det räkenskapsår som följer efter det år resultatet avser – öppna nästa år och klicka här.</p>
      </Step>
    </div>
  );
}
