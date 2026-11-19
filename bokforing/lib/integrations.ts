// Vilka integrationer som är uppsatta på servern och vad som krävs för resten (bara namn på variabler, aldrig värden)

export interface Integration {
  key: string; name: string; enables: string; vars: string[]; optional?: string[]; steps: string[]; testable?: boolean;
}

export const INTEGRATIONS: Integration[] = [
  { key: 'mail', name: 'E-post (Resend)', enables: 'Fakturor och påminnelser med e-post, tackmejl, sammandrag, schemalagda rapporter, inbjudningar', vars: ['RESEND_API_KEY', 'MAIL_FROM'], testable: true,
    steps: ['Skapa ett konto på resend.com och verifiera er domän (DNS-poster för SPF och DKIM).', 'Skapa en API-nyckel med behörighet att skicka.', 'Lägg in RESEND_API_KEY och MAIL_FROM (t.ex. "Bokföring <noreply@er-doman.se>") i Vercel och gör en ny deploy.'] },
  { key: 'inbox', name: 'Inkorg för leverantörsfakturor', enables: 'Varje bolag får en e-postadress dit leverantörer skickar fakturor', vars: ['INBOX_DOMAIN', 'RESEND_WEBHOOK_SECRET'],
    steps: ['Lägg till en domän för mottagning i Resend (t.ex. inbox.er-doman.se) med MX-post.', 'Skapa en webhook till https://<er-adress>/api/inbound/resend för händelsen email.received och kopiera signeringsnyckeln.', 'Lägg in INBOX_DOMAIN och RESEND_WEBHOOK_SECRET i Vercel.'] },
  { key: 'ai', name: 'Avläsning och assistent (Claude)', enables: 'Fakturor och kvitton läses av, assistenten, förslag på kontering', vars: ['ANTHROPIC_API_KEY'], testable: true,
    steps: ['Skapa en API-nyckel på console.anthropic.com.', 'Lägg in ANTHROPIC_API_KEY i Vercel.'] },
  { key: 'push', name: 'Pushnotiser', enables: 'Notiser i mobilen om attest, betalningar, deadlines och @nämn', vars: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'], optional: ['VAPID_SUBJECT'], testable: true,
    steps: ['Kör "npx web-push generate-vapid-keys" på din dator.', 'Lägg in VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY och VAPID_SUBJECT (mailto:support@er-doman.se) i Vercel.', 'Byt inte nycklarna senare – då måste alla slå på notiserna igen.'] },
  { key: 'bankid', name: 'BankID', enables: 'Logga in och signera dokument med BankID', vars: ['BANKID_OIDC_ISSUER', 'BANKID_CLIENT_ID', 'BANKID_CLIENT_SECRET'], optional: ['BANKID_ACR_VALUES', 'BANKID_PNR_CLAIM'], testable: true,
    steps: ['Teckna avtal med en BankID-leverantör som stöder OpenID Connect (t.ex. Criipto eller Signicat).', 'Registrera https://<er-adress>/api/bankid/callback som redirect-adress.', 'Lägg in utfärdaradress, klient-id och hemlighet i Vercel. Testa först med leverantörens testmiljö.'] },
  { key: 'bank', name: 'Bankkoppling (Enable Banking)', enables: 'Banktransaktioner hämtas automatiskt varje natt', vars: ['ENABLEBANKING_APP_ID', 'ENABLEBANKING_PRIVATE_KEY'], testable: true,
    steps: ['Registrera en applikation hos Enable Banking och ladda upp den publika nyckeln.', 'Lägg in app-id och den privata nyckeln (base64) i Vercel.'] },
  { key: 'stripe', name: 'Abonnemang och kortbetalning (Stripe)', enables: 'Abonnemang för kunderna och betalning av fakturor med kort', vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], optional: ['STRIPE_CONNECT_WEBHOOK_SECRET'], testable: true,
    steps: ['Skapa produkter och priser i Stripe.', 'Lägg till webhooks till /api/stripe/webhook (och /api/stripe/connect för kortbetalning).', 'Lägg in nycklarna i Vercel.'] },
  { key: 'cron', name: 'Schemalagda körningar', enables: 'Banksynk, påminnelser, avtalsfakturor, notiser, integritetskontroll', vars: ['CRON_SECRET'],
    steps: ['Lägg in CRON_SECRET (en lång slumpmässig sträng) i Vercel. Körningarna i vercel.json använder den automatiskt.'] },
];

export function integrationStatus(env: Record<string, string | undefined>) {
  return INTEGRATIONS.map((i) => {
    const missing = i.vars.filter((v) => !env[v]);
    return { ...i, configured: missing.length === 0, missing, missingOptional: (i.optional ?? []).filter((v) => !env[v]) };
  });
}
