-- Fullmakter, tillstånd och certifikat: register med giltighet, påminnelse före utgång och logg över återkallade fullmakter
CREATE TABLE IF NOT EXISTS authorizations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('power_of_attorney', 'permit', 'certificate')),
  name text NOT NULL,
  counterparty text NOT NULL DEFAULT '', -- myndighet, bank, certifieringsorgan
  holder text NOT NULL DEFAULT '',       -- ombud eller den fullmakten gäller
  scope text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  valid_from date,
  valid_until date,
  cost bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  revoked_on date,
  revoked_reason text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS authorizations_company ON authorizations (company_id, status);
