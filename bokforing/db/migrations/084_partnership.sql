-- Handelsbolag och kommanditbolag: bolagsformen och delägarna med andel i resultatet
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_company_type_check;
ALTER TABLE companies ADD CONSTRAINT companies_company_type_check CHECK (company_type IN ('AB','EF','HB','KB'));
CREATE TABLE partners (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  n            integer NOT NULL CHECK (n BETWEEN 1 AND 4),   -- delägare 1–4 → konto 2010, 2020, 2030, 2040
  name         text NOT NULL,
  identity     text NOT NULL DEFAULT '',                       -- person- eller organisationsnummer
  kind         text NOT NULL DEFAULT 'person' CHECK (kind IN ('person','company')),
  share_pct    numeric(6,3) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  limited      boolean NOT NULL DEFAULT false,                 -- kommanditdelägare (begränsat ansvar)
  contribution bigint NOT NULL DEFAULT 0,                      -- insats
  UNIQUE (company_id, n)
);
