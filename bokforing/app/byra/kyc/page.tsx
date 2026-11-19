import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { NotFoundError } from '@/lib/errors';
import { ENGAGEMENT_SERVICES, KYC_FACTORS, RISK_LABEL } from '@/lib/kyc';
import { getKyc, ownersRegisterEnabled } from '@/lib/services/kyc';
import { assess, engagement, owners } from './actions';

export const dynamic = 'force-dynamic';
const STATUS = { missing: ['Saknas', 'danger'], expired: ['Ska göras om', 'danger'], due: ['Ska göras om snart', 'warn'], ok: ['Aktuell', 'ok'] } as const;
const DOC: Record<string, string> = { draft: 'Utkast', pending: 'Väntar på signering', signed: 'Signerat', declined: 'Avböjt', cancelled: 'Makulerat' };

export default async function KycPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = Number(sp.f), c = Number(sp.c);
  const r = await getKyc(user.id, f, c).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const k = r.kyc;
  const [label, cls] = STATUS[r.status];
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 16px' }}>
      <p className="small"><Link href={`/byra?f=${f}`}>← Byråns klienter</Link></p>
      <h1>Kundkännedom: {r.client.name}</h1>
      <p className="muted">{r.client.orgnr} · <span className={`badge ${cls} kyc-status`}>{label}</span>{k?.risk && <> · Risk <b className="kyc-risk">{RISK_LABEL[k.risk]}</b></>}
        {k?.next_review && <> · görs om senast <b>{k.next_review}</b></>}{k?.assessed_by && <> · senast av {k.assessed_by} {k.assessed_at}</>}</p>
      <Flash searchParams={searchParams} />
      <p className="small muted">Penningtvättslagen kräver att byrån känner sina kunder: vem som äger och kontrollerar bolaget (verklig huvudman), om någon är person i politiskt utsatt ställning (PEP), affärsförbindelsens syfte och en riskbedömning som hålls aktuell. Uppgifterna är byråns egna och syns inte för kunden.</p>

      <h2>1. Verkliga huvudmän</h2>
      <div className="card stack">
        {k?.owners?.length ? <table className="small owners"><thead><tr><th>Namn</th><th>Född</th><th>Omfattning</th><th>Grund</th></tr></thead>
          <tbody>{k.owners.map((o, i) => <tr key={i}><td>{o.name}</td><td>{o.birthYear ?? ''}</td><td>{o.share}</td><td>{o.basis}</td></tr>)}</tbody></table>
          : <p className="small muted" style={{ margin: 0 }}>Inga huvudmän hämtade ännu.</p>}
        {k?.owners_fetched_at && <p className="small muted" style={{ margin: 0 }}>Hämtat från Bolagsverket {k.owners_fetched_at}</p>}
        <form action={owners.bind(null, f, c)}><button className="secondary" disabled={!ownersRegisterEnabled()}>Hämta från Bolagsverket</button>{!ownersRegisterEnabled() && <span className="small muted"> Bolagsverkets register är inte kopplat.</span>}</form>
      </div>

      <h2>2. Riskbedömning</h2>
      <form action={assess.bind(null, f, c)} className="card stack kyc-form">
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}><legend className="small"><b>Riskfaktorer</b></legend>
          {Object.entries(KYC_FACTORS).map(([key, x]) => <label key={key} className="check"><input type="checkbox" name="factor" value={key} defaultChecked={k?.factors?.includes(key as never)} /> {x.label}</label>)}</fieldset>
        <div className="row">
          <label>Person i politiskt utsatt ställning (PEP), eller familjemedlem/medarbetare till en sådan?<select name="pep" defaultValue={k?.pep == null ? '' : k.pep ? 'yes' : 'no'} required><option value="">Välj</option><option value="no">Nej</option><option value="yes">Ja</option></select></label>
          <label>Hur är företrädaren identifierad?<select name="identified" defaultValue={k?.identified ?? ''} required><option value="">Välj</option><option value="bankid">BankID</option><option value="meeting">Möte med id-handling</option><option value="remote">På distans utan BankID</option></select></label>
        </div>
        <label>Om PEP: vem och vilken befattning<input name="pep_details" defaultValue={k?.pep_details} /></label>
        <label>Affärsförbindelsens syfte och art<input name="purpose" defaultValue={k?.purpose} required placeholder="T.ex. löpande bokföring och bokslut för konsultverksamhet" /></label>
        <label>Anteckningar<textarea name="notes" rows={2} defaultValue={k?.notes} /></label>
        <div><button>Spara bedömning</button></div>
        <p className="small muted" style={{ margin: 0 }}>Låg risk görs om efter 24 månader, normal efter 12 och hög efter 6. PEP ger alltid hög risk och kräver skärpta åtgärder (ursprung till medel, godkännande av byråns ledning).</p>
      </form>

      <h2>3. Uppdragsbrev</h2>
      {k?.engagement_document_id && k.engagement_status !== 'cancelled' && k.engagement_status !== 'declined'
        ? <div className="card engagement">Uppdragsbrevet: <b>{DOC[k.engagement_status ?? ''] ?? k.engagement_status}</b> · <Link href={`/c/${c}/dokument/${k.engagement_document_id}`}>Visa</Link></div>
        : (
          <form action={engagement.bind(null, f, c)} className="card stack">
            {Object.entries(ENGAGEMENT_SERVICES).map(([key, l]) => <label key={key} className="check"><input type="checkbox" name="service" value={key} defaultChecked={key === 'bookkeeping' || key === 'vat'} /> {l}</label>)}
            <label>Arvode<input name="fee" required placeholder="T.ex. 2 500 kr per månad exkl. moms, övrigt 950 kr per timme" /></label>
            <div><button disabled={!k?.next_review || !r.owner}>Skicka uppdragsbrev för e-signering</button>
              <span className="small muted"> Signeras av {r.owner?.name ?? 'kundens ägare'} och dig.{!k?.next_review && ' Gör riskbedömningen först.'}</span></div>
          </form>
        )}

      {r.history.length > 0 && (<>
        <h2>Historik</h2>
        <table className="small"><tbody>{r.history.map((h, i) => <tr key={i}><td>{h.date}</td><td>{h.by}</td><td>{h.risk ? RISK_LABEL[h.risk as 'low'] : ''}</td></tr>)}</tbody></table>
      </>)}
    </div>
  );
}
