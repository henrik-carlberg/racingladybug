-- Licensavtal och royaltyrapporter
CREATE TABLE IF NOT EXISTS license_agreements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  licensee text NOT NULL,
  country text NOT NULL DEFAULT 'SE' CHECK (country ~ '^[A-Z]{2}$'),
  rate numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  minimum bigint NOT NULL DEFAULT 0 CHECK (minimum >= 0),
  treaty_rate numeric(5,2) CHECK (treaty_rate IS NULL OR (treaty_rate >= 0 AND treaty_rate <= 100)),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS royalty_reports (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agreement_id integer NOT NULL REFERENCES license_agreements(id) ON DELETE CASCADE,
  period text NOT NULL,
  date date NOT NULL,
  sales bigint NOT NULL,
  amount bigint NOT NULL,
  vat bigint NOT NULL DEFAULT 0,
  voucher_id integer REFERENCES vouchers(id),
  paid_on date,
  withheld bigint NOT NULL DEFAULT 0,
  payment_voucher_id integer REFERENCES vouchers(id),
  UNIQUE (agreement_id, period)
);
