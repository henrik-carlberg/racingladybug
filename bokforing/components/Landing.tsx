import Link from 'next/link';
import { PublicHeader } from './PublicHeader';
import { BASE_PRICE, MODULE_PRICE, TRIAL_DAYS } from '@/lib/billing';

const FEATURES: [string, string][] = [
  ['Bokföring och moms', 'Verifikationer, huvudbok, momsdeklarationens rutor, bokslut, årsredovisning (K2) och SIE.'],
  ['Fakturor som betalas', 'Fakturor med OCR, e-post, e-faktura (Peppol), Swish-QR, kortbetalning och ROT/RUT.'],
  ['Banken sköter sig själv', 'Bankkoppling, automatisk matchning och konteringsregler som lär sig.'],
  ['Leverantörsfakturor', 'Egen inkorgsadress, automatisk avläsning, attest och betalfil till banken.'],
  ['Lön och personal', 'Lön, AGI, frånvaro, semester, schema, personalliggare och självservice för anställda.'],
  ['Hela verksamheten', 'CRM, projekt, tidrapportering, lager, avtal, resursbokning, kassa och e-handel.'],
  ['Byråvy', 'Redovisningsbyråer ser alla klienter, deadlines och frågor på ett ställe.'],
  ['Tryggt', 'Passkeys, tvåstegsverifiering, behandlingshistorik och personuppgiftsbiträdesavtal.'],
];

/** Publik startsida för besökare som inte är inloggade */
export function Landing() {
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 16px 3rem' }}>
      <PublicHeader />
      <section style={{ padding: '3rem 0 2rem', maxWidth: 720 }}>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', lineHeight: 1.1, margin: 0 }}>Bokföring, fakturor, lön och hela verksamheten – på ett ställe.</h1>
        <p style={{ fontSize: '1.15rem' }} className="muted">För småföretag i Sverige. Banken stäms av automatiskt, fakturor läses av, moms och lön räknas rätt, och din redovisningskonsult arbetar i samma system.</p>
        <div className="actions"><Link className="btn" href="/register">Prova gratis i {TRIAL_DAYS} dagar</Link><Link className="btn secondary" href="/priser">Se priser</Link></div>
        <p className="small muted">Inget kort krävs. {BASE_PRICE / 100} kr/mån därefter, tillval från {MODULE_PRICE / 100} kr/mån.</p>
      </section>
      <section className="grid">
        {FEATURES.map(([t, d]) => <div key={t} className="card"><b>{t}</b><p className="small muted" style={{ marginBottom: 0 }}>{d}</p></div>)}
      </section>
      <section className="card" style={{ marginTop: '2rem' }}>
        <h2 style={{ marginTop: 0 }}>Byt från ett annat program på en kvart</h2>
        <p className="muted" style={{ marginBottom: 0 }}>Importera en SIE-fil med kontoplan, ingående balanser och verifikationer, och kunder, leverantörer och obetalda fakturor från CSV. Vill du prova först finns ett demobolag med exempeldata.</p>
      </section>
      <footer className="small muted" style={{ marginTop: '3rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <Link href="/villkor">Villkor</Link><Link href="/integritet">Integritetspolicy</Link><Link href="/hjalp">Hjälp</Link>
      </footer>
    </div>
  );
}
