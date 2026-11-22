-- Ackord vid företagsrekonstruktion
CREATE TABLE IF NOT EXISTS debt_settlements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reconstruction_on date NOT NULL,
  decided_on date NOT NULL,
  dividend_pct numeric(5,2) NOT NULL CHECK (dividend_pct >= 0 AND dividend_pct < 100),
  writedown bigint NOT NULL,
  to_pay bigint NOT NULL,
  pay_by date,
  invoices jsonb NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
