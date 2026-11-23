-- Returer och reklamationer: returärende mot en kundfaktura, kreditering eller ersättningsvara, återtag i lager eller kassation
CREATE TABLE IF NOT EXISTS return_cases (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  opened_on date NOT NULL,
  reason text NOT NULL CHECK (reason IN ('defect','damaged','wrong_item','regret','other')),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','credited','replaced','rejected')),
  closed_on date,
  credit_invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS return_cases_company ON return_cases (company_id, status);
CREATE TABLE IF NOT EXISTS return_lines (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES return_cases(id) ON DELETE CASCADE,
  invoice_line_id integer REFERENCES invoice_lines(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'st',
  unit_price bigint NOT NULL,
  vat_rate integer NOT NULL,
  account_number integer NOT NULL,
  product_id integer, -- inv_products (lagermodulens tabell skapas efter kärnans migreringar)
  disposition text CHECK (disposition IN ('restock','scrap')),
  unit_cost numeric(16,2)
);
