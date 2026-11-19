-- Företrädare enligt Bolagsverket och bekräftelser med BankID (automatisk verifiering av bolaget)
ALTER TABLE companies ADD COLUMN identity_method text CHECK (identity_method IN ('manual','bankid'));
UPDATE companies SET identity_method = 'manual' WHERE identity_verified_at IS NOT NULL;
CREATE TABLE company_representatives (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  roles       text[] NOT NULL DEFAULT '{}',
  pnr_hash    text NOT NULL,
  alone       boolean NOT NULL DEFAULT false,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, pnr_hash)
);
CREATE TABLE company_representation (
  company_id  integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  jointly     integer NOT NULL DEFAULT 2,
  text        text NOT NULL DEFAULT '',
  fetched_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE signatory_confirmations (
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pnr_hash     text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, pnr_hash)
);
