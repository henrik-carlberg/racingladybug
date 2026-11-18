import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { addDays, today } from '@/lib/format';
import { getInboxDoc } from '@/lib/services/inbox';
import { invoiceAiEnabled } from '@/lib/services/invoice-ai';
import { register, reject, retry } from '../actions';

export const dynamic = 'force-dynamic';

const dec = (ore: number | null | undefined) => (ore == null ? '' : (ore / 100).toFixed(2).replace('.', ','));
const TYPE: Record<string, string> = { credit_note: 'Kreditfaktura – registrera den som kreditering hos leverantören', receipt: 'Kvitto – redan betalt. Bokför det hellre som utlägg eller kvitto.', reminder: 'Påminnelse – kontrollera att fakturan inte redan är registrerad', other: 'Ser inte ut som en faktura' };

export default async function InboxDoc({ params, searchParams }: { params: Promise<{ cid: string; id: string }>; searchParams: SP }) {
  const { cid, id } = await params;
  const { company } = await requireCompany(cid);
  const { doc, suggestion: s } = await getInboxDoc(company.id, Number(id));
  const x = doc.extracted;
  const suppliers = await sql<{ id: number; name: string }[]>`SELECT id, name FROM suppliers WHERE company_id = ${company.id} ORDER BY name`;
  const accounts = await sql<{ number: number; name: string }[]>`SELECT number, name FROM accounts WHERE company_id = ${company.id} AND active AND number BETWEEN 1000 AND 8999 ORDER BY number`;
  const b = `/c/${company.id}/leverantorsfakturor`;
  const file = `${b}/inkorg/${doc.id}/fil`;
  const t = today();
  const done = doc.status === 'registered';
  return (
    <div>
      {doc.status === 'new' && <meta httpEquiv="refresh" content="4" />}
      <div className="header"><h1>{doc.filename || doc.subject || 'Mejl utan bilaga'}</h1><Link className="btn secondary" href={`${b}/inkorg`}>Tillbaka till inkorgen</Link></div>
      <Flash searchParams={searchParams} />
      <p className="small muted">{doc.source === 'email' ? <>Från {doc.from_address} · {doc.subject} · </> : 'Uppladdad · '}{doc.created_at}</p>
      {doc.status === 'new' && <div className="card">Fakturan läses av – sidan uppdateras automatiskt.</div>}
      {doc.error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{doc.error}</div>}
      {x && x.documentType !== 'invoice' && <div className="card" style={{ borderColor: 'var(--warn)' }}>{TYPE[x.documentType]}</div>}
      {x && x.currency !== 'SEK' && <div className="card" style={{ borderColor: 'var(--warn)' }}>Fakturan är i {x.currency}. Räkna om beloppen till kronor med bankens kurs innan du registrerar.</div>}
      {s.duplicateOf && <div className="card" style={{ borderColor: 'var(--danger)' }}>Fakturanumret finns redan för leverantören: <Link href={`${b}/${s.duplicateOf}`}>visa den registrerade fakturan</Link>.</div>}
      {done && doc.supplier_invoice_id && <div className="card"><span className="badge ok">Registrerad</span> <Link href={`${b}/${doc.supplier_invoice_id}`}>Visa leverantörsfakturan</Link></div>}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        {doc.has_file && (
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            {doc.mime_type === 'application/pdf'
              ? <iframe src={file} title="Fakturan" style={{ width: '100%', height: '75vh', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} />
              : <img src={file} alt="Fakturan" style={{ maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 8 }} />}
            <p className="small"><a href={file} target="_blank">Öppna i ny flik</a></p>
          </div>
        )}
        {!done && (
          <form action={register.bind(null, company.id, doc.id)} className="card stack" style={{ flex: '1 1 380px', margin: 0 }}>
            <b>Registrera som leverantörsfaktura</b>
            {x && <span className="small muted">Uppgifterna är avlästa automatiskt – kontrollera dem mot fakturan.</span>}
            <label>Leverantör
              <select name="supplier_id" defaultValue={s.supplierId ? String(s.supplierId) : 'new'}>
                <option value="new">+ Ny leverantör{x?.supplier.name ? `: ${x.supplier.name}` : ''}</option>
                {suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {!s.supplierId && (
              <fieldset className="stack" style={{ border: '1px dashed var(--border)', borderRadius: 8, padding: '.6rem' }}>
                <legend className="small">Ny leverantör (används om du väljer "Ny leverantör")</legend>
                <label>Namn<input name="new_name" defaultValue={x?.supplier.name} /></label>
                <div className="row">
                  <label>Org.nr<input name="new_orgnr" defaultValue={x?.supplier.orgnr} /></label>
                  <label>Bankgiro<input name="new_bankgiro" defaultValue={x?.supplier.bankgiro} /></label>
                  <label>Plusgiro<input name="new_plusgiro" defaultValue={x?.supplier.plusgiro} /></label>
                </div>
              </fieldset>
            )}
            <div className="row">
              <label>Fakturanummer<input name="invoice_number" defaultValue={x?.invoiceNumber} required /></label>
              <label>OCR / referens<input name="payment_reference" defaultValue={x?.paymentReference} /></label>
            </div>
            <div className="row">
              <label>Fakturadatum<input type="date" name="invoice_date" defaultValue={x?.invoiceDate || t} required /></label>
              <label>Förfallodatum<input type="date" name="due_date" defaultValue={x?.dueDate || addDays(x?.invoiceDate || t, 30)} required /></label>
            </div>
            <div className="row">
              <label>Att betala (kr)<input name="total" inputMode="decimal" defaultValue={dec(x?.total)} required /></label>
              <label>Varav moms (kr)<input name="vat" inputMode="decimal" defaultValue={dec(x?.vat ?? (x ? 0 : null))} /></label>
            </div>
            <label>Kostnadskonto
              <select name="account" defaultValue={String(s.account ?? x?.account ?? '')} required>
                <option value="">Välj konto…</option>
                {accounts.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}
              </select>
            </label>
            <label>Beskrivning<input name="description" defaultValue={x?.description} /></label>
            <div className="actions" style={{ margin: 0 }}><button>Registrera och bokför</button></div>
            <p className="small muted" style={{ margin: 0 }}>Fakturan sparas som underlag till verifikationen. Den behöver sedan attesteras innan den betalas.</p>
          </form>
        )}
      </div>
      {!done && (
        <div className="actions">
          {doc.has_file && invoiceAiEnabled() && <form action={retry.bind(null, company.id, doc.id)}><button className="secondary">Läs av igen</button></form>}
          <form action={reject.bind(null, company.id, doc.id)}><button className="secondary">Ta bort ur inkorgen</button></form>
        </div>
      )}
    </div>
  );
}
