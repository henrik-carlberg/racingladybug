-- Underkonsulter: inhyrda konsulter per kunduppdrag, rapporterad tid per månad, vidarefakturering med påslag och avstämning mot underkonsultens faktura
CREATE TABLE IF NOT EXISTS sub_assignments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  consultant text NOT NULL,
  name text NOT NULL,
  cost_rate bigint NOT NULL CHECK (cost_rate > 0), -- underkonsultens timpris exkl. moms
  bill_rate bigint NOT NULL CHECK (bill_rate > 0), -- kundens timpris exkl. moms
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sub_periods (
  id serial PRIMARY KEY,
  assignment_id integer NOT NULL REFERENCES sub_assignments(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  hours numeric(8,2) NOT NULL CHECK (hours > 0),
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL, -- vidarefakturering till kunden
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  supplier_hours numeric(8,2), -- timmar enligt underkonsultens faktura
  UNIQUE (assignment_id, period)
);
