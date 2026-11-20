-- Momsdeklarationer per period med ögonblicksbild av saldona, så att senare ändringar kan rättas
CREATE TABLE IF NOT EXISTS vat_declarations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('original','correction')),
  sums jsonb NOT NULL,
  to_pay bigint NOT NULL,
  to_pay_diff bigint NOT NULL DEFAULT 0,
  voucher_id integer REFERENCES vouchers(id),
  filing_id integer REFERENCES filings(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vat_declarations_period ON vat_declarations (company_id, period_from, period_to, id DESC);
