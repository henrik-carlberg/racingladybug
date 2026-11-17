import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { requestOrigin } from '@/lib/server/origin';
import { getDocument } from '@/lib/services/documents';
import { NotFoundError } from '@/lib/errors';
import { Flash, type SP } from '@/components/ui';
import { DocumentBody } from '@/components/DocumentBody';
import { SignPanel } from '@/components/SignPanel';
import { cancelDoc, sendDoc } from '../actions';

export const dynamic = 'force-dynamic';

const EVENT: Record<string, string> = { created: 'Skapat', sent: 'Skickat för signering', viewed: 'Öppnat', signed: 'Signerat', declined: 'Avböjt', completed: 'Klart och förseglat', cancelled: 'Återkallat' };
const METHOD: Record<string, string> = { passkey: 'Passkey (biometri/PIN)', password: 'Inloggad med lösenord', link: 'Personlig länk + namnbekräftelse' };

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ cid: string; did: string }>; searchParams: SP }) {
  const { cid, did } = await params;
  const { company, user } = await requireCompany(cid);
  const d = await getDocument(company.id, Number(did), await requestOrigin()).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [{ html }] = await sql<{ html: string | null }[]>`SELECT html FROM documents WHERE id = ${d.id}`;
  const mine = d.signers.find((s) => s.user_id === user.id && s.status === 'pending');
  const [{ n: passkeys }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM passkeys WHERE user_id = ${user.id}`;
  const b = `/c/${company.id}`;
  return (
    <>
      <div className="header no-print">
        <h1>{d.title}</h1>
        <div className="actions" style={{ margin: 0 }}>
          {d.status === 'draft' && <form action={sendDoc.bind(null, company.id, d.id)}><button>Skicka för signering</button></form>}
          {d.status === 'completed' && <Link className="btn" href={`${b}/dokument/${d.id}/utskrift`}>Signerat dokument (PDF/utskrift)</Link>}
          {(d.status === 'draft' || d.status === 'pending') && <form action={cancelDoc.bind(null, company.id, d.id)}><button className="link">Återkalla</button></form>}
          <Link className="btn secondary" href={`${b}/dokument`}>Tillbaka</Link>
        </div>
      </div>
      <Flash searchParams={searchParams} />
      {d.status === 'pending' && mine && <SignPanel signerId={mine.id} path={`${b}/dokument/${d.id}`} hasPasskey={passkeys > 0} name={mine.name} />}

      <h2>Undertecknare</h2>
      <table>
        <thead><tr><th>Namn</th><th>Status</th><th>Metod</th><th>Länk</th></tr></thead>
        <tbody>{d.signers.map((s) => (
          <tr key={s.id}>
            <td>{s.name}<div className="small muted">{s.email}{s.type === 'internal' ? ' · intern' : ''}</div></td>
            <td>{s.status === 'signed' ? <span className="badge ok">Signerat {s.signed_at}</span> : s.status === 'declined' ? <span className="badge danger">Avböjt</span> : <span className="badge warn">Väntar</span>}
              {s.decline_reason && <div className="small">{s.decline_reason}</div>}</td>
            <td className="small">{s.method ? METHOD[s.method] : ''}</td>
            <td className="small">{s.signing_url ? <code className="mono" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{s.signing_url}</code> : ''}</td>
          </tr>
        ))}</tbody>
      </table>
      {d.status === 'completed' && (
        <p className="small">Förseglat {d.completed_at && new Date(d.completed_at).toLocaleString('sv-SE')}. Försegling: {d.seal_valid ? <span className="badge ok">Giltig – oförändrat</span> : <span className="badge danger">Ogiltig!</span>}</p>
      )}

      <h2>Dokument</h2>
      <p className="small muted mono">SHA-256: {d.sha256}</p>
      <DocumentBody kind={d.kind} html={html} pdfUrl={`${b}/dokument/${d.id}/fil`} filename={d.filename} />

      <h2>Händelselogg</h2>
      <table><tbody>{d.events?.map((e, i) => (
        <tr key={i}><td className="small">{e.at}</td><td>{EVENT[e.event] ?? e.event}</td><td>{e.signer ?? ''}</td><td className="small muted">{e.ip ?? ''}</td></tr>
      ))}</tbody></table>
    </>
  );
}
