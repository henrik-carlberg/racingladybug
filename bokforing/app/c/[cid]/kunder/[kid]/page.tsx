import { History } from '@/components/History';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { CustomerFields, type CustomerRow } from '@/components/CustomerFields';
import { saveCustomer, portal } from '../actions';
import { requestOrigin } from '@/lib/server/origin';
import { apEnabled } from '@/lib/server/peppol-ap';
import { lookupCustomer } from '../../peppol/actions';

export const dynamic = 'force-dynamic';

export default async function Customer({ params, searchParams }: { params: Promise<{ cid: string; kid: string }>; searchParams: SP }) {
  const { cid, kid } = await params;
  const { company } = await requireCompany(cid, { perm: 'invoicing' });
  const [c] = await sql<CustomerRow[]>`SELECT * FROM customers WHERE id = ${Number(kid)} AND company_id = ${company.id}`;
  if (!c) notFound();
  const [{ token }] = await sql<{ token: string | null }[]>`SELECT portal_token AS token FROM customers WHERE id = ${c.id}`;
  const origin = await requestOrigin();
  return (
    <>
      <h1>{c.name}</h1>
      <Flash searchParams={searchParams} />
      <form action={saveCustomer.bind(null, company.id, c.id)} className="card stack">
        <CustomerFields c={c} />
        <div><button>Spara</button></div>
      </form>
      {apEnabled() && <form action={lookupCustomer.bind(null, company.id, c.id)} className="actions"><button className="secondary">Slå upp i Peppol</button><span className="small muted">Kontrollerar om kunden kan ta emot e-faktura och sparar Peppol-ID:t.</span></form>}
      <h2>Kundportal</h2>
      <div className="card stack small">
        <p style={{ margin: 0 }}>En hemlig länk där kunden ser alla sina fakturor, betalar med kort (om kortbetalning är påslagen), godkänner offerter och uppdaterar sina kontaktuppgifter.</p>
        {token ? <div>Länk: <code className="portal-url">{`${origin}/k/${token}`}</code></div> : null}
        <div className="actions" style={{ margin: 0 }}>
          <form action={portal.bind(null, company.id, c.id, false)}><button className="secondary">{token ? 'Visa länk' : 'Skapa länk till kundportalen'}</button></form>
          {token && <form action={portal.bind(null, company.id, c.id, true)}><button className="link">Ny länk (den gamla slutar fungera)</button></form>}
        </div>
      </div>
      <History companyId={company.id} entity="customer" id={c.id} />
    </>
  );
}
