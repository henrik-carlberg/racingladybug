-- Konsignationslager hos återförsäljare
CREATE TABLE IF NOT EXISTS consignment_items (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  article text NOT NULL,
  unit_cost bigint NOT NULL CHECK (unit_cost >= 0),
  unit_price bigint NOT NULL CHECK (unit_price > 0),
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  UNIQUE (company_id, customer_id, article)
);
CREATE TABLE IF NOT EXISTS consignment_moves (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES consignment_items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ship','return','sold')),
  qty integer NOT NULL CHECK (qty > 0),
  date date NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id)
);
