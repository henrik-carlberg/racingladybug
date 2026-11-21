-- Utdelning till utländska ägare med kupongskatt
CREATE TABLE IF NOT EXISTS foreign_dividends (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  recipient_type text NOT NULL CHECK (recipient_type IN ('person','company')),
  holding_pct numeric(6,2) NOT NULL DEFAULT 0,
  business_related boolean NOT NULL DEFAULT false,
  date date NOT NULL,
  gross bigint NOT NULL CHECK (gross > 0),
  pct numeric(5,2) NOT NULL,
  withheld bigint NOT NULL,
  paid_to_skv boolean NOT NULL DEFAULT false,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
