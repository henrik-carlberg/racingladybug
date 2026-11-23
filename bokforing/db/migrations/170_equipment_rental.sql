-- Uthyrning av utrustning: individer med serienummer, hyresavtal från utlämning till återlämning, fakturering per period med dag-, vecko- och månadspris, tillägg för skador och försening
CREATE TABLE IF NOT EXISTS rental_items (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  serial text NOT NULL,
  name text NOT NULL,
  day_rate bigint NOT NULL CHECK (day_rate > 0),
  week_rate bigint CHECK (week_rate > 0),
  month_rate bigint CHECK (month_rate > 0),
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0,6,12,25)),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, serial)
);
CREATE TABLE IF NOT EXISTS rental_contracts (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id integer NOT NULL REFERENCES rental_items(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  expected_end date,
  returned_on date,
  invoiced_until date,
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rental_contracts_one_out ON rental_contracts (item_id) WHERE returned_on IS NULL;
CREATE TABLE IF NOT EXISTS rental_invoices (
  id serial PRIMARY KEY,
  contract_id integer NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  rent bigint NOT NULL,
  extras bigint NOT NULL DEFAULT 0
);
