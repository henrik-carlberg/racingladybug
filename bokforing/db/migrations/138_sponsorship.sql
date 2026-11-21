-- Sponsring och gåvor till affärsförbindelser med bedömning av avdragsrätt
CREATE TABLE IF NOT EXISTS sponsorships (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sponsor','gift')),
  date date NOT NULL,
  recipient text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  vat bigint NOT NULL DEFAULT 0 CHECK (vat >= 0),
  counter_performance text NOT NULL DEFAULT '',
  recipients integer NOT NULL DEFAULT 1 CHECK (recipients > 0),
  deductible boolean NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
