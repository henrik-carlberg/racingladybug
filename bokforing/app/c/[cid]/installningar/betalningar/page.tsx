import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { cardPaymentsAvailable, paymentIssues, paymentStatus, refreshStripeAccount } from '@/lib/services/payments';
import { connect, disconnect, refresh, resolve } from './actions';

export const dynamic = 'force-dynamic';

export default async function Payments({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid);
  const sp = await searchParams;
  if (sp.stripe === 'return' || sp.stripe === 'refresh') await refreshStripeAccount(company.id).catch(() => null);
  const [st, issues] = await Promise.all([paymentStatus(company.id), paymentIssues(company.id)]);
  const owner = role === 'owner';
  const b = `/c/${company.id}`;
  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Kortbetalning av fakturor</h1>
      <Flash searchParams={searchParams} />
      <p className="muted">Kunden får en knapp ”Betala nu” på fakturalänken och betalar med kort (och Swish eller Klarna om du slår på det i Stripe). Pengarna går till ditt eget Stripe-konto och betalas ut till banken av Stripe.
        Fakturan markeras som betald och bokförs automatiskt.</p>
      {!cardPaymentsAvailable() ? <div className="card small muted">Kortbetalning är inte uppsatt på tjänsten ännu.</div> : (
        <div className="card stack">
          {!st.account ? (
            <>
              <div>Inget Stripe-konto är kopplat.</div>
              {owner && <form action={connect.bind(null, company.id)}><button>Koppla Stripe-konto</button></form>}
              <p className="small muted" style={{ margin: 0 }}>Du skapar eller kopplar ett Stripe-konto för {company.name} och fyller i bolagets uppgifter hos Stripe. Stripe tar en avgift per betalning enligt deras prislista.</p>
            </>
          ) : st.enabled ? (
            <div><span className="badge ok">Aktivt</span> Kunderna kan betala fakturor med kort. <span className="small muted">Stripe-konto {st.account}</span></div>
          ) : (
            <>
              <div><span className="badge warn">Inte klart</span> Stripe behöver fler uppgifter innan kortbetalningar kan tas emot.</div>
              {owner && <div className="actions" style={{ margin: 0 }}><form action={connect.bind(null, company.id)}><button>Fortsätt hos Stripe</button></form><form action={refresh.bind(null, company.id)}><button className="secondary">Uppdatera status</button></form></div>}
            </>
          )}
          {st.account && owner && <form action={disconnect.bind(null, company.id)}><button className="link small">Stäng av kortbetalning</button></form>}
        </div>
      )}
      <h2>Så bokförs det</h2>
      <ul className="small">
        <li>När kunden har betalat bokförs inbetalningen mot <b>1580 Fordringar för kontokort</b> (kundfordran 1510 kvittas).</li>
        <li>När Stripe betalar ut till banken matchar du utbetalningen mot 1580 i <Link href={`${b}/bank/avstamning`}>bankavstämningen</Link>. Regeln ”Utbetalning från Stripe” bland de <Link href={`${b}/bank/regler`}>vanliga reglerna</Link> gör det automatiskt.</li>
        <li>Stripes avgifter dras från utbetalningen. Bokför dem på 6570 Bankkostnader enligt Stripes månadsfaktura så att 1580 går jämnt ut.</li>
      </ul>
      {issues.length > 0 && (
        <>
          <h2>Att kontrollera</h2>
          <p className="small muted">Kortbetalningar som inte bokfördes automatiskt, t.ex. för att fakturan redan var betald eller beloppet ändrats. Återbetala dubbelbetalningar i Stripe.</p>
          <table className="small"><tbody>{issues.map((x) => (
            <tr key={x.id}><td><Link href={`${b}/fakturor/${x.invoice_id}`}>Faktura {x.number}</Link></td><td className="num">{kr(x.amount)}</td><td>{x.paid_at}</td>
              <td><form action={resolve.bind(null, company.id, x.id)}><button className="link">Hanterad</button></form></td></tr>
          ))}</tbody></table>
        </>
      )}
    </div>
  );
}
