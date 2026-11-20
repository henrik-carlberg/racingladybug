import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { kr, today } from '@/lib/format';
import { finalReport, overview } from '@/lib/services/capital-control';
import { drawSheet, holdMeeting, liquidate, liquidationStep } from './actions';

export const dynamic = 'force-dynamic';
const STAGE: Record<string, string> = { drawn: 'Upprättad', first_meeting: 'Första kontrollstämman hållen', second_meeting: 'Andra kontrollstämman hållen', restored: 'Ingen kapitalbrist / återställt', liquidation: 'Likvidation' };

/** Kapitalbrist: kontrollbalansräkning, kontrollstämmor och likvidation (aktiebolagslagen 25 kap.) */
export default async function ControlBalance({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'ledger' });
  const b = `/c/${company.id}`;
  if (company.company_type !== 'AB') return <div style={{ maxWidth: 760 }}><h1>Kontrollbalansräkning</h1><EmptyState icon="briefcase" title="Gäller aktiebolag">Reglerna om kapitalbrist och kontrollbalansräkning gäller aktiebolag.</EmptyState></div>;
  const o = await overview(company.id);
  const final = o.liquidation ? await finalReport(company.id) : null;
  const t = today();
  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Kapitalbrist och kontrollbalansräkning</h1>
      <Flash searchParams={searchParams} />
      <div className="grid">
        <div className="card stat"><div className="label">Aktiekapital</div><div className="value cb-share">{kr(o.shareCapital)}</div></div>
        <div className="card stat"><div className="label">Bokfört eget kapital idag</div><div className="value cb-equity">{kr(o.equity)}</div><div className="small muted">varav årets resultat {kr(o.result)}</div></div>
        <div className="card stat"><div className="label">Gräns (halva aktiekapitalet)</div><div className="value">{kr(o.now.half)}</div></div>
      </div>
      {o.now.deficit
        ? <div className="card cb-warning" style={{ borderColor: 'var(--danger)' }}><b>Det finns skäl att anta att det egna kapitalet understiger halva aktiekapitalet.</b> Styrelsen ska genast upprätta en kontrollbalansräkning och låta revisorn granska den.
            Gör styrelsen inte det blir ledamöterna personligt ansvariga för bolagets nya förpliktelser. I kontrollbalansräkningen får obeskattade reserver räknas med till 79,4 % och tillgångar tas upp till verkligt värde.</div>
        : <p className="small cb-ok">Det bokförda egna kapitalet överstiger halva aktiekapitalet.</p>}

      {!o.liquidation && (
        <form action={drawSheet.bind(null, company.id)} className="card stack cb-draw">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Upprätta kontrollbalansräkning</h2>
          <label>Per datum<input type="date" name="date" defaultValue={t} required /></label>
          <label>Justeringar till verkligt värde (en per rad: beskrivning; belopp i kr, minus för undervärden)
            <textarea name="adjustments" rows={3} placeholder={'Övervärde fastighet enligt värdering; 150000\nInkurant lager; -20000'} /></label>
          <label>Granskad av revisor<input name="audited_by" maxLength={200} placeholder="Namn, revisionsbyrå" /></label>
          <button>Upprätta</button>
        </form>
      )}

      {o.open && (
        <div className="card stack cb-open">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{o.open.stage === 'drawn' ? 'Första kontrollstämman' : 'Andra kontrollstämman'}</h2>
          {o.open.stage === 'drawn'
            ? <p className="small" style={{ margin: 0 }}>Styrelsen ska snarast kalla till en kontrollstämma som beslutar om bolaget ska gå i likvidation eller fortsätta. Kontrollbalansräkningen och revisorns yttrande ska läggas fram.</p>
            : <p className="small" style={{ margin: 0 }}>Den andra kontrollstämman ska hållas senast <b className="cb-deadline">{o.deadline}</b>. Kan bolaget då inte visa en ny kontrollbalansräkning där det egna kapitalet uppgår till hela aktiekapitalet ska stämman besluta om likvidation – annars ska styrelsen ansöka om likvidation hos tingsrätten.</p>}
          <form action={holdMeeting.bind(null, company.id)} className="row">
            <label>Stämmans datum<input type="date" name="date" defaultValue={t} required /></label>
            <label>Beslut<select name="outcome">{o.open.stage === 'drawn'
              ? <><option value="continue">Bolaget ska fortsätta</option><option value="liquidate">Bolaget ska gå i likvidation</option></>
              : <><option value="restored">Kapitalet är återställt</option><option value="liquidate">Bolaget ska gå i likvidation</option></>}</select></label>
            <label>Likvidator (vid likvidation)<input name="liquidator" maxLength={200} /></label>
            <div style={{ flex: '0 0 auto' }}><button>Registrera stämman</button></div>
          </form>
        </div>
      )}

      {o.sheets.length > 0 && (
        <>
          <h2>Kontrollbalansräkningar</h2>
          <table className="cb-sheets"><thead><tr><th>Datum</th><th className="num">Bokfört eget kapital</th><th className="num">Obeskattade reserver (79,4 %)</th><th className="num">Justeringar</th><th className="num">Eget kapital</th><th>Status</th></tr></thead>
            <tbody>{o.sheets.map((s) => (
              <tr key={s.id} className={`cb-sheet ${s.deficit ? 'deficit' : ''}`}><td>{s.date}</td><td className="num">{kr(s.booked_equity)}</td><td className="num">{kr(Math.round(s.untaxed * 0.794))}</td>
                <td className="num">{kr(s.adjustments.reduce((a, x) => a + x.amount, 0))}</td><td className="num"><b>{kr(s.equity)}</b></td>
                <td>{s.deficit ? <span className="badge danger">Kapitalbrist</span> : <span className="badge ok">Täckt</span>} {STAGE[s.stage]}{s.first_meeting ? `, första stämman ${s.first_meeting}` : ''}{s.second_meeting ? `, andra ${s.second_meeting}` : ''}</td></tr>))}</tbody></table>
        </>
      )}

      {o.liquidation ? (
        <section className="card stack cb-liquidation">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Likvidation</h2>
          <p style={{ margin: 0 }}>Beslutad {o.liquidation.decided_on} ({o.liquidation.reason === 'capital' ? 'kapitalbrist' : 'frivillig'}), likvidator {o.liquidation.liquidator}.</p>
          <ol className="small">
            <li>Anmälan till Bolagsverket: {o.liquidation.registered_on ?? <i>ej gjord</i>}</li>
            <li>Kallelse på okända borgenärer (sex månader): {o.liquidation.creditor_notice_on ?? <i>ej kungjord</i>}</li>
            <li>Skifte och slutredovisning: {o.liquidation.final_report_on ?? <i>ej klar</i>}</li>
          </ol>
          <form action={liquidationStep.bind(null, company.id)} className="row">
            <label>Steg<select name="step"><option value="registered_on">Anmält till Bolagsverket</option><option value="creditor_notice_on">Kallelse på okända borgenärer</option><option value="final_report_on">Slutredovisning</option></select></label>
            <label>Datum<input type="date" name="date" defaultValue={t} required /></label>
            <div style={{ flex: '0 0 auto' }}><button className="secondary">Registrera</button></div>
          </form>
          {final && <>
            <h3 style={{ margin: 0 }}>Slutredovisning per {final.at}</h3>
            <p className="small" style={{ margin: 0 }}>Tillgångar {kr(final.assets)} kr, skulder och avsättningar {kr(final.liabilities)} kr, att skifta <b className="cb-net">{kr(final.net)}</b> kr.</p>
            <table className="cb-distribution"><tbody>{final.owners.map((x) => <tr key={x.name} className="cb-owner"><td>{x.name}</td><td className="num">{x.pct} %</td><td className="num">{kr(x.amount)}</td></tr>)}</tbody></table>
            <p className="small muted" style={{ margin: 0 }}>Skiftet beskattas hos ägarna som avyttring av aktierna (K10 eller K4). <Link href={`${b}/agare`}>Ägare</Link></p>
          </>}
        </section>
      ) : (
        <details className="card">
          <summary>Frivillig likvidation</summary>
          <form action={liquidate.bind(null, company.id)} className="row">
            <label>Bolagsstämmans beslut<input type="date" name="decided_on" defaultValue={t} required /></label>
            <label>Likvidator<input name="liquidator" required maxLength={200} /></label>
            <div style={{ flex: '0 0 auto' }}><button className="danger">Registrera likvidationsbeslut</button></div>
          </form>
        </details>
      )}
    </div>
  );
}
