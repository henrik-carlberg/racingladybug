-- Ränta på skattekontot och anstånd med inbetalning av skatt
CREATE TABLE IF NOT EXISTS tax_interest_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  base_rate integer NOT NULL CHECK (base_rate BETWEEN 0 AND 2000) -- basräntan i hundradels procent
);
CREATE TABLE IF NOT EXISTS tax_interest_bookings (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  cost bigint NOT NULL, income bigint NOT NULL,
  voucher_id integer NOT NULL REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_interest_bookings_company ON tax_interest_bookings (company_id, period);
CREATE TABLE IF NOT EXISTS tax_deferrals (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  note text NOT NULL DEFAULT '',
  ended_at date,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_deferrals_company ON tax_deferrals (company_id, end_date);
