-- Återkommande leverantörsfakturor (hyra, leasing, abonnemang)
CREATE TABLE IF NOT EXISTS supplier_templates (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  description text NOT NULL,
  total bigint NOT NULL CHECK (total > 0),
  vat bigint NOT NULL DEFAULT 0 CHECK (vat >= 0),
  account integer NOT NULL,
  due_day integer NOT NULL DEFAULT 25 CHECK (due_day BETWEEN 1 AND 31),
  start_period text NOT NULL CHECK (start_period ~ '^\d{4}-\d{2}$'),
  end_period text CHECK (end_period IS NULL OR end_period ~ '^\d{4}-\d{2}$'),
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS supplier_template_periods (
  template_id integer NOT NULL REFERENCES supplier_templates(id) ON DELETE CASCADE,
  period text NOT NULL,
  supplier_invoice_id integer NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, period)
);
