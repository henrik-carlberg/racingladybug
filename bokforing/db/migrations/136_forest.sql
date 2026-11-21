-- Skogsbruk i enskild firma: likvider från avverkning, skogskonto/skogsskadekonto och skogsavdrag
CREATE TABLE IF NOT EXISTS forest_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  acquisition_value bigint NOT NULL DEFAULT 0 CHECK (acquisition_value >= 0),
  used_before bigint NOT NULL DEFAULT 0 CHECK (used_before >= 0)
);
CREATE TABLE IF NOT EXISTS forest_sales (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('rotpost','leveransvirke')),
  amount bigint NOT NULL CHECK (amount > 0),
  note text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS forest_transactions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tax_year integer NOT NULL,
  date date NOT NULL,
  account text NOT NULL CHECK (account IN ('skog','skada')),
  kind text NOT NULL CHECK (kind IN ('deposit','withdrawal')),
  amount bigint NOT NULL CHECK (amount > 0),
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS forest_deductions (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tax_year integer NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (company_id, tax_year)
);
