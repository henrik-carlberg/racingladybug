// Uppgifter om den som driver tjänsten (personuppgiftsbiträdet). Sätts med miljövariabler i driften.
export const PROVIDER = {
  name: process.env.PROVIDER_NAME || 'Tjänsteleverantören',
  orgnr: process.env.PROVIDER_ORGNR || '',
  email: process.env.PROVIDER_EMAIL || '',
};
export const DPA_VERSION = '2026-11';

/** Underbiträden som används i en standarddrift (Vercel + Neon). Justera efter din faktiska drift. */
export const SUBPROCESSORS = [
  { name: 'Vercel Inc.', purpose: 'Drift av webbtjänsten', location: 'EU/USA (EU:s standardavtalsklausuler, Data Privacy Framework)' },
  { name: 'Neon Inc.', purpose: 'Databas', location: 'EU (Frankfurt)' },
  { name: 'Stripe Payments Europe Ltd.', purpose: 'Betalning av abonnemang', location: 'EU/Irland' },
  { name: 'Resend Inc.', purpose: 'Utskick av e-post (fakturor, inbjudningar)', location: 'USA (EU:s standardavtalsklausuler)' },
  { name: 'Enable Banking Oy', purpose: 'Bankkoppling (om den används)', location: 'EU/Finland' },
];

/** Bokföringslagen: räkenskapsinformation sparas till och med sjunde året efter kalenderårets utgång */
export const RETENTION_YEARS = 7;
