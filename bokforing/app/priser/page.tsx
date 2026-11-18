import Link from 'next/link';
import { PublicHeader } from '@/components/PublicHeader';
import { currentUser } from '@/lib/server/auth';
import { BASE_PRICE, FREE_MODULES, MODULE_PRICE, TRIAL_DAYS } from '@/lib/billing';
import { MODULES } from '@/modules/registry';

export const metadata = { title: 'Priser – Bokföring' };

export default async function Pricing() {
  const user = await currentUser();
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 16px 3rem' }}>
      <PublicHeader loggedIn={!!user} />
      <h1>Priser</h1>
      <p className="muted">Ett pris per bolag. Dina anställda, din redovisningskonsult och din byrå ingår. Alla priser exklusive moms. Säg upp när du vill.</p>
      <div className="grid">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Grundpaket</h2>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{BASE_PRICE / 100} kr<span className="small muted">/mån</span></div>
          <ul className="small">
            <li>Bokföring, moms, bokslut, årsredovisning och SIE</li><li>Kund- och leverantörsfakturor, inkorg, e-faktura och betalfil</li>
            <li>Bank med automatisk avstämning och konteringsregler</li><li>Lön, AGI, frånvaro, schema och personalliggare</li>
            <li>Tidrapportering, kostnadsställen, anläggningsregister, kassa och e-handel</li><li>Kundportal, byråvy, API och webhooks</li>
          </ul>
          <Link className="btn" href="/register">Prova gratis i {TRIAL_DAYS} dagar</Link>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Tillval</h2>
          <div style={{ fontSize: '2rem', fontWeight: 700 }}>{MODULE_PRICE / 100} kr<span className="small muted">/mån per modul</span></div>
          <ul className="small">{MODULES.map((m) => <li key={m.id}><b>{m.name}</b>{FREE_MODULES.includes(m.id) ? ' – ingår' : ''}<div className="muted">{m.description}</div></li>)}</ul>
        </div>
      </div>
      <h2>Vanliga frågor</h2>
      <dl className="small">
        <dt><b>Vad händer efter provperioden?</b></dt><dd>Du väljer att starta abonnemanget med kort. Gör du inget låses bolaget för nya bokningar, men du kan alltid exportera din bokföring.</dd>
        <dt><b>Kostar kortbetalningar och avläsning av fakturor extra?</b></dt><dd>Kortbetalningar kostar Stripes avgift per betalning. Avläsningen av leverantörsfakturor ingår.</dd>
        <dt><b>Kan jag byta från ett annat program?</b></dt><dd>Ja, importera en SIE-fil. Kontoplan, ingående balanser och verifikationer följer med.</dd>
      </dl>
    </div>
  );
}
