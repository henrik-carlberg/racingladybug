-- Bygg och entreprenad: ÄTA-arbeten på fastprisuppdrag och innehållna belopp på kund- och leverantörsfakturor
CREATE TABLE poc_change_orders (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id integer NOT NULL REFERENCES poc_contracts(id) ON DELETE CASCADE,
  no          integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('tillagg','andring','avgaende')),
  description text NOT NULL,
  amount      bigint NOT NULL CHECK (amount >= 0),   -- ändring av kontraktssumman (avgående räknas negativt)
  cost        bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status      text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  decided_on  date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, no)
);
CREATE TABLE retentions (
  id                  serial PRIMARY KEY,
  company_id          integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  side                text NOT NULL CHECK (side IN ('customer','supplier')),
  invoice_id          integer REFERENCES invoices(id) ON DELETE CASCADE,
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  amount              bigint NOT NULL CHECK (amount > 0),
  pct                 numeric(5,2) NOT NULL,
  date                date NOT NULL,
  release_after       date,
  note                text NOT NULL DEFAULT '',
  voucher_id          integer REFERENCES vouchers(id) ON DELETE SET NULL,
  released_on         date,
  release_voucher_id  integer REFERENCES vouchers(id) ON DELETE SET NULL,
  CHECK ((side = 'customer') = (invoice_id IS NOT NULL) AND (side = 'supplier') = (supplier_invoice_id IS NOT NULL))
);
CREATE UNIQUE INDEX retentions_invoice ON retentions (invoice_id) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX retentions_supplier_invoice ON retentions (supplier_invoice_id) WHERE supplier_invoice_id IS NOT NULL;
