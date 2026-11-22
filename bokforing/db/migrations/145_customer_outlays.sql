-- Utlägg för kunds räkning: betalas mot fordran (1680) och faktureras utan moms
CREATE TABLE IF NOT EXISTS customer_outlays (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  date date NOT NULL,
  description text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  voucher_id integer REFERENCES vouchers(id),
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
