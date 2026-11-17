import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { createDoc } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  draft: ['Utkast', ''], pending: ['Väntar på signering', 'warn'], completed: ['Signerat', 'ok'], declined: ['Avböjt', 'danger'], cancelled: ['Återkallat', ''],
};

export default async function Documents({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, user } = await requireCompany(cid);
  const docs = await sql<{ id: number; title: string; status: string; created: string; signed: number; total: number; source_module: string | null }[]>`
    SELECT d.id, d.title, d.status, to_char(d.created_at AT TIME ZONE 'Europe/Stockholm','YYYY-MM-DD') AS created, d.source_module,
      count(s.id) FILTER (WHERE s.status = 'signed')::int AS signed, count(s.id)::int AS total
    FROM documents d JOIN document_signers s ON s.document_id = d.id WHERE d.company_id = ${company.id}
    GROUP BY d.id ORDER BY d.id DESC LIMIT 300`;
  const members = await sql<{ id: number; name: string }[]>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ${company.id} ORDER BY u.name`;
  const b = `/c/${company.id}`;
  return (
    <>
      <h1>Dokument och e-signering</h1>
      <Flash searchParams={searchParams} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Dokument</th><th>Skapat</th><th>Signaturer</th><th>Status</th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td><Link href={`${b}/dokument/${d.id}`}>{d.title}</Link>{d.source_module && <span className="badge" style={{ marginLeft: 6 }}>{d.source_module.toUpperCase()}</span>}</td>
                <td>{d.created}</td><td>{d.signed}/{d.total}</td>
                <td><span className={`badge ${STATUS[d.status]?.[1] ?? ''}`}>{STATUS[d.status]?.[0] ?? d.status}</span></td>
              </tr>
            ))}
            {docs.length === 0 && <tr><td colSpan={4} className="muted">Inga dokument ännu.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Nytt dokument</h2>
      <form action={createDoc.bind(null, company.id)} className="card stack">
        <label>Titel<input name="title" required placeholder="T.ex. Sekretessavtal" /></label>
        <label>Dokumenttext<textarea name="text" rows={8} placeholder="Skriv eller klistra in avtalstexten. Tom rad = nytt stycke." /></label>
        <label>…eller ladda upp PDF<input type="file" name="file" accept="application/pdf" /></label>
        <label>Meddelande till undertecknarna (valfritt)<input name="message" /></label>
        <b>Undertecknare</b>
        {[0, 1, 2, 3].map((i) => (
          <div className="row" key={i}>
            <label>Intern användare<select name={`user_${i}`} defaultValue={i === 0 ? String(user.id) : ''}>
              <option value="">– Extern person –</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></label>
            <label>Namn (extern)<input name={`name_${i}`} /></label>
            <label>E-post (extern)<input name={`email_${i}`} type="email" /></label>
          </div>
        ))}
        {members.map((m) => <input key={m.id} type="hidden" name={`uname_${m.id}`} value={m.name} />)}
        <label className="check"><input type="checkbox" name="send" defaultChecked /> Skicka för signering direkt</label>
        <div><button>Skapa dokument</button></div>
        <p className="small muted" style={{ margin: 0 }}>Interna användare signerar inloggade med passkey eller lösenord. Externa personer får en personlig länk
          {process.env.RESEND_API_KEY ? ' via e-post' : ' som du kopierar och skickar (e-postutskick aktiveras med RESEND_API_KEY)'}.</p>
      </form>
    </>
  );
}
