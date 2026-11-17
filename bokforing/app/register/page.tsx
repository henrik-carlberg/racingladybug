import Link from 'next/link';
import { register } from '../auth-actions';
import { Flash, type SP } from '@/components/ui';
import { TRIAL_DAYS, BASE_PRICE, MODULE_PRICE } from '@/lib/billing';

export default function Register({ searchParams }: { searchParams: SP }) {
  return (
    <div className="center">
      <h1>Kom igång gratis</h1>
      <p className="muted">Bokföring, fakturering, moms, lön och bokslut för ditt företag. Prova alla funktioner i {TRIAL_DAYS} dagar – inget kort krävs.
        Därefter {BASE_PRICE / 100} kr/mån per bolag plus {MODULE_PRICE / 100} kr/mån per tilläggsmodul (exkl. moms). Din redovisningskonsult och dina anställda ingår.</p>
      <Flash searchParams={searchParams} />
      <form action={register} className="card stack">
        <label>Namn<input name="name" required autoComplete="name" /></label>
        <label>E-post<input name="email" type="email" required autoComplete="email" /></label>
        <label>Lösenord (minst 10 tecken)<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
        <label className="check"><input type="checkbox" name="terms" required /> Jag godkänner villkoren och att personuppgifter behandlas för att leverera tjänsten (GDPR)</label>
        <button>Skapa konto</button>
      </form>
      <p className="muted">Har du redan ett konto? <Link href="/login">Logga in</Link></p>
    </div>
  );
}
