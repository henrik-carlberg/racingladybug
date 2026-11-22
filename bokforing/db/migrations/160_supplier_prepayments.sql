-- Förskott till leverantörer (1480) som avräknas mot slutfakturan
CREATE TABLE IF NOT EXISTS supplier_prepayments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  used bigint NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= amount),
  note text NOT NULL DEFAULT '',
  voucher_id integer NOT NULL REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_prepayments_company ON supplier_prepayments (company_id, supplier_id);
CREATE TABLE IF NOT EXISTS supplier_prepayment_uses (
  id serial PRIMARY KEY,
  prepayment_id integer NOT NULL REFERENCES supplier_prepayments(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('settled','refunded')),
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  date date NOT NULL,
  voucher_id integer NOT NULL REFERENCES vouchers(id)
);
