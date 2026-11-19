import { UseSharedFile } from '@/components/SharedFile';
import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP, EmptyState } from '@/components/ui';
import { kr } from '@/lib/format';
import { companyInboxAddress, listInbox } from '@/lib/services/inbox';
import { invoiceAiEnabled } from '@/lib/services/invoice-ai';
import { reopen, rotateAddress, upload } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, [string, string]> = {
  new: ['Tolkas…', ''], ready: ['Att granska', 'warn'], failed: ['Granska manuellt', 'danger'], registered: ['Registrerad', 'ok'], rejected: ['Borttagen', ''],
};

export default async function Inbox({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid, { perm: 'purchasing' });
  const [address, open, handled] = await Promise.all([companyInboxAddress(company.id), listInbox(company.id, { open: true }), listInbox(company.id)]);
  const b = `/c/${company.id}/leverantorsfakturor`;
  const ai = invoiceAiEnabled();
  return (
    <div style={{ maxWidth: 1000 }}>
      {open.some((d) => d.status === 'new') && <meta httpEquiv="refresh" content="5" />}
      <div className="header"><h1>Inkorg för leverantörsfakturor</h1><Link className="btn secondary" href={b}>Alla leverantörsfakturor</Link></div>
      <Flash searchParams={searchParams} />
      <UseSharedFile input="files" />
      <div className="card stack">
        {address ? (
          <div>Be leverantörerna skicka fakturor till <code className="inbox-address" style={{ fontSize: '1.05em' }}>{address}</code>, eller vidarebefordra dem dit. PDF och bilder i mejlet hamnar här.
            {role === 'owner' && <form action={rotateAddress.bind(null, company.id)} style={{ display: 'inline', marginLeft: '.5rem' }}><button className="link small">Byt adress (vid skräppost)</button></form>}</div>
        ) : <div className="small muted">E-postmottagning är inte uppsatt (INBOX_DOMAIN och Resend). Du kan ladda upp fakturor här så länge.</div>}
        <form action={upload.bind(null, company.id)} className="row" style={{ alignItems: 'end' }}>
          <label style={{ flex: '3 1 300px' }}>Ladda upp fakturor (PDF, JPG, PNG eller e-faktura XML)<input type="file" name="files" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.xml,application/xml,text/xml" required /></label>
          <div style={{ flex: '0 0 auto' }}><button>Ladda upp</button></div>
        </form>
        <p className="small muted" style={{ margin: 0 }}>{ai ? 'Fakturorna läses av automatiskt (leverantör, belopp, moms, OCR, förfallodag och konto). Du granskar och godkänner innan något bokförs.'
          : 'Automatisk avläsning är inte påslagen (ANTHROPIC_API_KEY). Du fyller i uppgifterna själv med fakturan bredvid.'}</p>
      </div>

      <h2>Att hantera ({open.length})</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>Mottagen</th><th>Från / fil</th><th>Leverantör</th><th className="num">Belopp</th><th>Förfaller</th><th>Status</th></tr></thead>
        <tbody>
          {open.map((d) => (
            <tr key={d.id}>
              <td className="small">{d.created_at}</td>
              <td><Link href={`${b}/inkorg/${d.id}`}>{d.filename || d.subject || 'Mejl utan bilaga'}</Link><div className="small muted">{d.source === 'email' ? d.from_address : 'Uppladdad'}</div></td>
              <td>{d.extracted?.supplier.name}</td>
              <td className="num">{d.extracted?.total != null ? `${kr(d.extracted.total)} ${d.extracted.currency !== 'SEK' ? d.extracted.currency : ''}` : ''}</td>
              <td className="small">{d.extracted?.dueDate}</td>
              <td><span className={`badge ${STATUS[d.status][1]}`}>{STATUS[d.status][0]}</span>{d.error && <div className="small muted">{d.error}</div>}</td>
            </tr>
          ))}
          {open.length === 0 && <tr><td colSpan={6}><EmptyState icon="inbox" title="Inkorgen är tom">{address ? <>Nya fakturor som mejlas till <b>{address}</b> dyker upp här, lästa och klara att granska.</> : 'Ladda upp fakturor ovan så läses de av och kan granskas här.'}</EmptyState></td></tr>}
        </tbody>
      </table></div>

      {handled.length > 0 && (
        <details><summary>Hanterade ({handled.length})</summary>
          <table className="small"><tbody>{handled.map((d) => (
            <tr key={d.id}><td>{d.created_at}</td><td>{d.filename || d.subject}</td><td>{d.extracted?.supplier.name}</td>
              <td><span className={`badge ${STATUS[d.status][1]}`}>{STATUS[d.status][0]}</span></td>
              <td className="num">{d.supplier_invoice_id ? <Link href={`${b}/${d.supplier_invoice_id}`}>Visa faktura</Link>
                : <form action={reopen.bind(null, company.id, d.id)}><button className="link">Ångra</button></form>}</td></tr>
          ))}</tbody></table>
        </details>
      )}
    </div>
  );
}
