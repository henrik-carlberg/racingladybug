-- Pensionssparande för enskild näringsidkare
CREATE TABLE IF NOT EXISTS ef_pension_payments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  insurer text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ef_pension_settings (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  income bigint,
  has_occupational boolean NOT NULL DEFAULT false,
  PRIMARY KEY (company_id, year)
);
