-- Franchise: franchisetagare med avtal, inträdesavgift som periodiseras över avtalstiden, månadsrapporter om omsättning med royalty och marknadsavgift, marknadsföringsfond som avskild skuld
CREATE TABLE IF NOT EXISTS franchisees (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  unit text NOT NULL DEFAULT '', -- enhet/ort
  start_date date NOT NULL,
  end_date date NOT NULL,
  entry_fee bigint NOT NULL DEFAULT 0 CHECK (entry_fee >= 0),
  royalty_pct numeric(5,2) NOT NULL CHECK (royalty_pct >= 0 AND royalty_pct < 100),
  marketing_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (marketing_pct >= 0 AND marketing_pct < 100),
  entry_invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  entry_recognized bigint NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id),
  CHECK (end_date > start_date),
  UNIQUE (company_id, customer_id, unit)
);
CREATE TABLE IF NOT EXISTS franchise_reports (
  id serial PRIMARY KEY,
  franchisee_id integer NOT NULL REFERENCES franchisees(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  turnover bigint NOT NULL CHECK (turnover >= 0),
  royalty bigint NOT NULL,
  marketing bigint NOT NULL,
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  UNIQUE (franchisee_id, period)
);
CREATE TABLE IF NOT EXISTS franchise_entries (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('entry_recognition','fund_use')),
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  description text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
