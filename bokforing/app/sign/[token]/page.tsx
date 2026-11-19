import { bankidEnabled } from '@/lib/services/bankid';
import { bankidSignLink } from '@/app/bankid-actions';
import { clientInfo } from '@/lib/server/origin';
import { getSigningView } from '@/lib/services/documents';
import { Flash, type SP } from '@/components/ui';
import { DocumentBody } from '@/components/DocumentBody';
import { decline, sign } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signera dokument', referrer: 'no-referrer', robots: { index: false } };

export default async function SignPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SP }) {
  const { token } = await params;
  const s = await getSigningView(token, await clientInfo());
  if (!s) return <div className="center"><h1>Länken är ogiltig</h1><p>Kontrollera att du har kopierat hela länken.</p></div>;
  const open = s.status === 'pending' && s.doc_status === 'pending';
  return (
    <main style={{ maxWidth: 860, margin: '0 auto' }}>
      <p className="muted small">{s.company} ({s.orgnr}) har skickat ett dokument till dig, {s.name}.</p>
      <h1>{s.title}</h1>
      <Flash searchParams={searchParams} />
      {s.status === 'signed' && <div className="flash ok">Du signerade dokumentet {s.signed_at}. Tack!</div>}
      {s.status === 'declined' && <div className="flash error">Du har avböjt att signera dokumentet.</div>}
      {s.doc_status === 'cancelled' && <div className="flash error">Dokumentet har återkallats av avsändaren.</div>}
      {s.doc_status === 'completed' && s.status === 'signed' && <p className="muted">Alla parter har signerat. Avsändaren kan ge dig en kopia med verifieringsbilaga.</p>}
      {s.message && <div className="card">{s.message}</div>}
      <DocumentBody kind={s.kind} html={s.html} pdfUrl={`/sign/${token}/fil`} filename={s.filename} />
      <p className="small muted mono">Dokumentets SHA-256: {s.sha256}</p>
      {open && (
        <>
          {bankidEnabled() && <form action={bankidSignLink.bind(null, token)} className="card row" style={{ alignItems: 'center', borderColor: 'var(--accent)' }}><button className="bankid-btn">Signera med BankID</button><span className="small muted">Rekommenderas – eller signera med ditt namn nedan.</span></form>}
          <form action={sign.bind(null, token)} className="card stack" style={{ borderColor: 'var(--accent)' }}>
            <h2 style={{ margin: 0 }}>Signera</h2>
            <label className="check"><input type="checkbox" name="consent" required /> Jag har läst dokumentet och godkänner innehållet. Jag förstår att min elektroniska signatur är juridiskt bindande.</label>
            <label>Skriv ditt fullständiga namn: <b>{s.name}</b><input name="signed_name" required autoComplete="name" /></label>
            <div><button>Signera dokumentet</button></div>
            <p className="small muted" style={{ margin: 0 }}>Tidpunkt, IP-adress och webbläsare registreras som bevis för signeringen.</p>
          </form>
          <details className="card">
            <summary>Avböj att signera</summary>
            <form action={decline.bind(null, token)} className="row" style={{ marginTop: '.5rem' }}>
              <label>Anledning (valfritt)<input name="reason" /></label>
              <div style={{ flex: '0 0 auto' }}><button className="danger">Avböj</button></div>
            </form>
          </details>
        </>
      )}
    </main>
  );
}
