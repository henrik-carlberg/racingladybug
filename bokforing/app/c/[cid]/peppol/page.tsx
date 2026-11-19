import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { EmptyState, Flash, type SP } from '@/components/ui';
import { apEnabled } from '@/lib/server/peppol-ap';
import { listMessages, participantFor } from '@/lib/services/peppol';
import { refreshPeppol } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, [string, string]> = { sent: ['Skickad', 'warn'], delivered: ['Levererad', 'ok'], failed: ['Misslyckad', 'danger'], received: ['Mottagen', 'ok'] };

export default async function Peppol({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const b = `/c/${company.id}`;
  const list = await listMessages(company.id);
  const on = apEnabled();
  return (
    <div style={{ maxWidth: 980 }}>
      <h1>E-faktura via Peppol</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">{on ? <>Bolaget tar emot e-fakturor på Peppol-ID <code>{participantFor(company.orgnr)}</code>. Mottagna fakturor hamnar i <Link href={`${b}/leverantorsfakturor/inkorg`}>inkorgen</Link> färdiga att registrera. Skicka från en bokförd faktura.</>
        : 'Ingen Peppol-åtkomstpunkt är uppsatt. Ladda ner e-fakturan som XML från fakturan och skicka den via din operatör.'}</p>
      {on && <form action={refreshPeppol.bind(null, company.id, `${b}/peppol`)} className="actions"><button className="secondary">Hämta leveransstatus</button></form>}
      {list.length === 0 ? <EmptyState icon="invoice" title="Inga e-fakturor än">Skickade och mottagna e-fakturor visas här med leveransstatus.</EmptyState> : (
        <table>
          <thead><tr><th>Datum</th><th>Riktning</th><th>Dokument</th><th>Motpart</th><th>Status</th></tr></thead>
          <tbody>{list.map((m) => (
            <tr key={m.id}>
              <td>{m.created_at}</td><td>{m.direction === 'out' ? 'Skickad' : 'Mottagen'}</td>
              <td>{m.invoice_id ? <Link href={`${b}/fakturor/${m.invoice_id}`}>Faktura {m.invoice_number}</Link> : m.inbox_document_id ? <Link href={`${b}/leverantorsfakturor/inkorg/${m.inbox_document_id}`}>Leverantörsfaktura</Link> : '–'}</td>
              <td><code>{m.direction === 'out' ? m.receiver : m.sender}</code></td>
              <td><span className={`badge ${ST[m.status][1]}`}>{ST[m.status][0]}</span>{m.message && <div className="small muted">{m.message}</div>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
