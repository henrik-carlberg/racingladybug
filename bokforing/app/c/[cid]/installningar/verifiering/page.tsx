import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { bankidEnabled } from '@/lib/services/bankid';
import { representationStatus, representativesEnabled } from '@/lib/services/signatory';
import { confirm } from './actions';

export const dynamic = 'force-dynamic';

export default async function Verification({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const ctx = await requireCompany(cid);
  const s = await representationStatus(ctx.company.id, ctx.user.id);
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="header"><h1>Verifiera bolaget</h1><Link className="btn secondary" href={`/c/${ctx.company.id}/installningar`}>Inställningar</Link></div>
      <Flash searchParams={searchParams} />
      <p className="muted">E-faktura via Peppol och direktinlämning till Skatteverket och Bolagsverket sker i bolagets namn. Därför behöver vi veta att den som använder kontot företräder bolaget. Logga in med BankID – är du firmatecknare enligt Bolagsverket blir bolaget verifierat direkt.</p>
      {s.verified ? (
        <div className="card verified"><span className="badge ok">Verifierat</span> {s.verified} {s.method === 'bankid' ? 'med BankID av firmatecknare' : 'av supporten'}.</div>
      ) : (
        <div className="card stack">
          <div><span className="badge">Inte verifierat</span></div>
          {!bankidEnabled() ? <p style={{ margin: 0 }}>BankID är inte uppsatt på tjänsten. Kontakta supporten för att verifiera bolaget.</p>
            : !s.hasBankId ? <p style={{ margin: 0 }}>Koppla först BankID till ditt konto under <Link href="/konto#bankid">Mitt konto</Link>, kom sedan tillbaka hit.</p>
            : s.type !== 'EF' && !representativesEnabled() ? <p style={{ margin: 0 }}>Hämtning av firmatecknare från Bolagsverket är inte uppsatt. Kontakta supporten för att verifiera bolaget.</p>
            : <form action={confirm.bind(null, ctx.company.id)}><button>{s.type === 'EF' ? 'Bekräfta att jag är innehavare (BankID)' : 'Bekräfta att jag är firmatecknare (BankID)'}</button></form>}
        </div>
      )}
      {s.reps.length > 0 && (
        <>
          <h2>Företrädare enligt Bolagsverket</h2>
          {s.rule && <p className="small muted">{s.rule.text || `Firman tecknas av ${s.rule.jointly} i förening.`} Hämtat {s.rule.fetched}.</p>}
          <table>
            <thead><tr><th>Namn</th><th>Roll</th><th>Firmateckning</th><th>Bekräftat</th></tr></thead>
            <tbody>{s.reps.map((r, i) => (
              <tr key={i}><td>{r.name}{r.me && <b> (du)</b>}</td><td>{r.roles.join(', ')}</td><td>{r.alone ? 'Ensam' : 'I förening'}</td><td>{r.confirmed ? <span className="badge ok">Ja</span> : '–'}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
    </div>
  );
}
