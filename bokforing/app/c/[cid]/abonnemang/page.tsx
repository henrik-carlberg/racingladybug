import Link from 'next/link';
import { requireCompany } from '@/lib/server/auth';
import { Flash, type SP } from '@/components/ui';
import { kr } from '@/lib/format';
import { billingEnforced } from '@/lib/billing';
import { billingOverview } from '@/lib/services/billing';
import { getModule } from '@/modules/registry';
import { openPortal, startCheckout } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = { trialing: 'Provperiod', active: 'Aktivt', past_due: 'Betalning misslyckades', canceled: 'Avslutat', unpaid: 'Obetalt', incomplete: 'Inte slutfört' };

export default async function Billing({ params, searchParams }: { params: Promise<{ cid: string }>; searchParams: SP }) {
  const { cid } = await params;
  const { company, role } = await requireCompany(cid, { allowLocked: true });
  const b = await billingOverview(company.id);
  const a = b.access;
  const isOwner = role === 'owner';
  return (
    <div style={{ maxWidth: 800 }}>
      <h1>Abonnemang</h1>
      <Flash searchParams={searchParams} />
      {a.state === 'locked' && <div className="flash error">Provperioden är slut. Starta abonnemanget för att fortsätta använda bolaget. Din data finns kvar och kan alltid <Link href={`/c/${company.id}/rapporter/export`}>exporteras som SIE</Link>.</div>}
      {a.state === 'past_due' && <div className="flash error">Senaste betalningen gick inte igenom. Uppdatera kortet inom {a.daysLeft} dagar.</div>}
      <div className="grid">
        <div className="card stat"><div className="label">Status</div><div className="value" style={{ fontSize: '1.2rem' }}>
          {b.exempt ? 'Kostnadsfritt' : a.state === 'trial' ? `Provperiod – ${a.daysLeft} dagar kvar` : STATUS[b.status] ?? b.status}</div>
          {b.current_period_end && <div className="small muted">{b.cancel_at_period_end ? 'Avslutas' : 'Förnyas'} {b.current_period_end}</div>}
          {a.state === 'trial' && <div className="small muted">t.o.m. {b.trial_ends_at}</div>}</div>
        <div className="card stat"><div className="label">Pris per månad exkl. moms</div><div className="value">{kr(b.price.total)}</div>
          <div className="small muted">grund {kr(b.price.base)} + {b.price.paid.length} moduler {kr(b.price.modules)}</div></div>
      </div>
      <div className="card">
        <b>Det här ingår</b>
        <ul className="small">
          <li>Grundpris {kr(b.price.base)} kr: bokföring, kund- och leverantörsfakturor, moms, lön och AGI, bank, kvitton, deadlines, bokslut och deklaration, tidrapportering, e-signering, API och obegränsat antal användare (konsult och anställda).</li>
          {b.price.paid.map((m) => <li key={m}>{getModule(m)?.name ?? m}: {kr(b.price.modules / Math.max(1, b.price.paid.length))} kr</li>)}
        </ul>
        <p className="small muted">Slå på och av moduler under <Link href={`/c/${company.id}/moduler`}>Moduler</Link>. Priset justeras från nästa dag.</p>
      </div>
      {!b.exempt && isOwner && (
        <div className="card actions">
          {!b.stripe && <span className="small">Kortbetalning är inte konfigurerad på den här installationen.</span>}
          {b.stripe && (b.status !== 'active' || !b.stripe_subscription_id) && <form action={startCheckout.bind(null, company.id)}><button>Starta abonnemang – betala med kort</button></form>}
          {b.stripe && b.stripe_customer_id && <form action={openPortal.bind(null, company.id)}><button className="secondary">Hantera betalning, kvitton och uppsägning</button></form>}
        </div>
      )}
      {!isOwner && <p className="small">Ägaren hanterar abonnemanget.</p>}
      {!billingEnforced() && <p className="small muted">Betalningskontrollen är avstängd på den här installationen (BILLING_ENFORCED).</p>}
      <p className="small muted">Ingen bindningstid. Säg upp när du vill – du har kvar tillgången perioden ut och kan alltid exportera all bokföring (SIE).</p>
    </div>
  );
}
