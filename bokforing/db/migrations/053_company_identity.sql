-- Verifierat organisationsnummer: krävs för Peppol (skicka och ta emot) och direktinlämning till myndigheter.
-- Endast ett bolag per organisationsnummer kan vara verifierat.
ALTER TABLE companies ADD COLUMN identity_verified_at timestamptz;
ALTER TABLE companies ADD COLUMN identity_verified_by integer REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX companies_verified_orgnr ON companies ((regexp_replace(orgnr, '\D', '', 'g'))) WHERE identity_verified_at IS NOT NULL;
