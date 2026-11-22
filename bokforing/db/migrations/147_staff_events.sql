-- Personalfester och intern representation
CREATE TABLE IF NOT EXISTS staff_events (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  title text NOT NULL,
  persons integer NOT NULL CHECK (persons > 0),
  total bigint NOT NULL,
  vat_deducted bigint NOT NULL,
  non_deductible bigint NOT NULL,
  warnings text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
