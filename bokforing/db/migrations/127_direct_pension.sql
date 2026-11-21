-- Direktpension enligt tryggandelagen
CREATE TABLE IF NOT EXISTS pension_commitments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  person text NOT NULL,
  description text NOT NULL DEFAULT '',
  insured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pension_entries (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  commitment_id integer NOT NULL REFERENCES pension_commitments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('valuation','payment')),
  date date NOT NULL,
  capital_value bigint,
  change bigint NOT NULL,
  slp bigint NOT NULL DEFAULT 0,
  voucher_id integer REFERENCES vouchers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
