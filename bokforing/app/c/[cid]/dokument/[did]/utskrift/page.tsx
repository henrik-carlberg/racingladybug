import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { getDocument } from '@/lib/services/documents';
import { NotFoundError } from '@/lib/errors';
import { DocumentBody } from '@/components/DocumentBody';
import { PrintButton } from '@/components/PrintButton';

export const dynamic = 'force-dynamic';
const METHOD: Record<string, string> = { passkey: 'Passkey (biometri/PIN, WebAuthn)', password: 'Inloggad användare, lösenord', link: 'Personlig länk och namnbekräftelse', bankid: 'BankID (personnummer verifierat)' };

/** Signerat dokument med verifieringsbilaga – skriv ut eller spara som PDF */
export default async function Print({ params }: { params: Promise<{ cid: string; did: string }> }) {
  const { cid, did } = await params;
  const { company } = await requireCompany(cid);
  const d = await getDocument(company.id, Number(did)).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [{ html }] = await sql<{ html: string | null }[]>`SELECT html FROM documents WHERE id = ${d.id}`;
  return (
    <>
      <div className="actions no-print"><PrintButton /></div>
      <DocumentBody kind={d.kind} html={html} pdfUrl={`/c/${company.id}/dokument/${d.id}/fil`} filename={d.filename} />
      <div className="doc" style={{ pageBreakBefore: 'always', marginTop: '2rem' }}>
        <h2 style={{ marginTop: 0 }}>Verifieringsbilaga – elektronisk signering</h2>
        <p className="small">Dokument: <b>{d.title}</b> (id {d.id})<br />Utfärdat av: {company.name}, {company.orgnr}<br />
          Dokumentets SHA-256: <span className="mono">{d.sha256}</span><br />
          Status: {d.status === 'completed' ? `Signerat av samtliga ${d.completed_at ? new Date(d.completed_at).toLocaleString('sv-SE') : ''}` : d.status}<br />
          Försegling: {d.seal_valid == null ? '–' : d.seal_valid ? 'giltig (signeringsbeviset är oförändrat)' : 'OGILTIG'}</p>
        <table>
          <thead><tr><th>Undertecknare</th><th>Signerat</th><th>Metod</th><th>IP-adress</th></tr></thead>
          <tbody>{d.signers.map((s) => (
            <tr key={s.id}><td>{s.signed_name ?? s.name}<div className="small">{s.email}</div></td><td>{s.signed_at ?? '–'}</td><td className="small">{s.method ? METHOD[s.method] : s.status}</td><td className="small">{s.ip ?? ''}</td></tr>
          ))}</tbody>
        </table>
        <h3>Händelser</h3>
        <table><tbody>{d.events?.map((e, i) => <tr key={i}><td className="small">{e.at}</td><td className="small">{e.event}</td><td className="small">{e.signer ?? ''}</td><td className="small">{e.ip ?? ''}</td></tr>)}</tbody></table>
        <p className="small" style={{ marginTop: '1rem' }}>Varje signatur är knuten till dokumentets SHA-256-hash. Ändras dokumentet efter signering stämmer hashen inte längre.
          Signeringsbeviset är förseglat med en kryptografisk kontrollsumma (HMAC-SHA256) som verifieras vid visning.</p>
      </div>
    </>
  );
}
