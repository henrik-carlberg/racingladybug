-- Service- och garantiärenden: ärenden på sålda varor med garantitid från fakturadatum, arbete och material, garantikostnad mot garantiavsättningen eller faktura utanför garantin
CREATE TABLE IF NOT EXISTS service_cases (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  item text NOT NULL,
  serial text NOT NULL DEFAULT '',
  sold_on date,
  warranty_months integer NOT NULL DEFAULT 12 CHECK (warranty_months BETWEEN 0 AND 120),
  opened_on date NOT NULL,
  fault text NOT NULL,
  cause text NOT NULL DEFAULT 'other' CHECK (cause IN ('material','manufacturing','wear','handling','other')),
  in_warranty boolean NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_on date,
  invoice_out_id integer REFERENCES invoices(id) ON DELETE SET NULL, -- faktura för service utanför garantin
  provision_voucher_id integer REFERENCES vouchers(id),
  cost_total bigint NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS service_cases_company ON service_cases (company_id, status);
CREATE TABLE IF NOT EXISTS service_case_lines (
  id serial PRIMARY KEY,
  case_id integer NOT NULL REFERENCES service_cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('labor','material')),
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit_price bigint NOT NULL CHECK (unit_price >= 0) -- exkl. moms
);
