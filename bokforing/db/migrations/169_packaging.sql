-- Returemballage och pant: pant per förpackningstyp debiteras på faktura (skuld, ingen intäkt), saldo per kund, kreditering vid retur, förverkad pant tas upp som intäkt
CREATE TABLE IF NOT EXISTS packaging_types (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  deposit bigint NOT NULL CHECK (deposit > 0), -- pant i öre per enhet
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS packaging_movements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type_id integer NOT NULL REFERENCES packaging_types(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('out','return','forfeit')),
  quantity integer NOT NULL CHECK (quantity > 0),
  deposit bigint NOT NULL, -- pant per enhet vid händelsen
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS packaging_movements_customer ON packaging_movements (company_id, customer_id, type_id);
