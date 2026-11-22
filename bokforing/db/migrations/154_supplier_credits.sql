-- Kreditfakturor från leverantörer
CREATE TABLE IF NOT EXISTS supplier_credits (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  original_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  credit_number text NOT NULL,
  date date NOT NULL,
  total bigint NOT NULL CHECK (total > 0),
  vat bigint NOT NULL DEFAULT 0 CHECK (vat >= 0),
  used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  UNIQUE (company_id, supplier_id, credit_number),
  CHECK (used <= total)
);
CREATE TABLE IF NOT EXISTS supplier_credit_uses (
  id serial PRIMARY KEY,
  credit_id integer NOT NULL REFERENCES supplier_credits(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('applied','refunded')),
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  date date NOT NULL,
  voucher_id integer REFERENCES vouchers(id)
);
