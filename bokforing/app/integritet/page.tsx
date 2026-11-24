import Link from 'next/link';
import { PROVIDER, SUBPROCESSORS } from '@/lib/legal';
import { APP_NAME } from '@/lib/brand';

export const metadata = { title: `Integritetspolicy – ${APP_NAME}` };

export default function Privacy() {
  const p = PROVIDER;
  return (
    <div className="center legal" style={{ maxWidth: 760 }}>
      <h1>Integritetspolicy</h1>
      <p><b>{p.name}</b>{p.orgnr ? ` (${p.orgnr})` : ''} tillhandahåller tjänsten. {p.email && <>Kontakt: {p.email}.</>}</p>
      <h2>Ditt konto</h2>
      <p>För ditt användarkonto är vi personuppgiftsansvariga. Vi behandlar namn, e-post, inloggningsuppgifter (lösenord som hash, passkeys) och en logg över vad du gör i tjänsten. Ändamålet är att leverera tjänsten och hålla den säker. Rättslig grund är avtal och berättigat intresse. Uppgifterna sparas så länge du har ett konto.</p>
      <h2>Bolagens uppgifter</h2>
      <p>Uppgifter som ett bolag lägger in om anställda, kunder och leverantörer behandlar vi som personuppgiftsbiträde åt bolaget, enligt ett personuppgiftsbiträdesavtal. Har du frågor om dem, kontakta bolaget.</p>
      <h2>Betalning och e-post</h2>
      <p>Abonnemang betalas via Stripe, som tar emot kortuppgifterna direkt. E-post (fakturor, inbjudningar) skickas via en e-posttjänst.</p>
      <h2>Underbiträden</h2>
      <ul>{SUBPROCESSORS.map((s) => <li key={s.name}>{s.name} – {s.purpose} ({s.location})</li>)}</ul>
      <h2>Cookies</h2>
      <p>Vi använder bara nödvändiga cookies för inloggning. Inga cookies för spårning eller annonser.</p>
      <h2>Dina rättigheter</h2>
      <p>Du har rätt att få ett registerutdrag, få fel rättade, få uppgifter raderade, invända mot behandling och flytta dina uppgifter. Det mesta gör du själv under <Link href="/konto#gdpr">Mitt konto</Link>. Du kan klaga hos Integritetsskyddsmyndigheten (imy.se).</p>
      <p><Link href="/villkor">Användarvillkor</Link> · <Link href="/">Till tjänsten</Link></p>
    </div>
  );
}
