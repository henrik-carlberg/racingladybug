import Link from 'next/link';
import { PROVIDER } from '@/lib/legal';
import { BASE_PRICE, MODULE_PRICE, TRIAL_DAYS } from '@/lib/billing';
import { kr } from '@/lib/format';
import { APP_NAME } from '@/lib/brand';

export const metadata = { title: `Användarvillkor – ${APP_NAME}` };

export default function Terms() {
  return (
    <div className="center legal" style={{ maxWidth: 760 }}>
      <h1>Användarvillkor</h1>
      <p>Tjänsten tillhandahålls av {PROVIDER.name}.</p>
      <h2>Tjänsten och priset</h2>
      <p>De första {TRIAL_DAYS} dagarna är gratis. Därefter kostar grundtjänsten {kr(BASE_PRICE)} kr per månad och varje tillvalsmodul {kr(MODULE_PRICE)} kr per månad, exklusive moms. Abonnemanget löper månadsvis och kan sägas upp när som helst. Det gäller till periodens slut.</p>
      <h2>Ditt ansvar</h2>
      <p>Du ansvarar för att bokföringen, deklarationerna och lönerna blir rätt och lämnas in i tid. Tjänsten räknar enligt gällande regler men ersätter inte en redovisningskonsult. Granska underlag innan du lämnar in dem.</p>
      <h2>Dina uppgifter</h2>
      <p>Uppgifterna tillhör dig. Du kan alltid exportera bokföringen (SIE) och dina personuppgifter. Om abonnemanget upphör är tjänsten låst för nya bokningar men export fungerar fortfarande. Behandlingen av personuppgifter regleras i <Link href="/integritet">integritetspolicyn</Link> och i personuppgiftsbiträdesavtalet.</p>
      <h2>Tillgänglighet och ansvar</h2>
      <p>Vi gör vårt bästa för att tjänsten ska vara tillgänglig och säker men kan inte garantera att den alltid fungerar utan avbrott. Vårt ansvar är begränsat till vad du har betalat de senaste tolv månaderna, utom vid uppsåt eller grov vårdslöshet.</p>
      <p><Link href="/">Till tjänsten</Link></p>
    </div>
  );
}
