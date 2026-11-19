-- Autogiro: medgivanden, dragningar och filer
ALTER TABLE companies ADD COLUMN autogiro_customer_no text NOT NULL DEFAULT '';
CREATE TABLE ag_mandates (
  id           serial PRIMARY KEY,
  company_id   int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payer_number text NOT NULL,
  clearing     text NOT NULL,
  account      text NOT NULL,
  id_number    text NOT NULL,
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','sent','active','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payer_number)
);
CREATE TABLE ag_files (
  id         serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('mandates','draws')),
  content    text NOT NULL,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ag_draws (
  id         serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id int NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  mandate_id int NOT NULL REFERENCES ag_mandates(id),
  file_id    int NOT NULL REFERENCES ag_files(id),
  date       date NOT NULL,
  amount     bigint NOT NULL,
  reference  text NOT NULL,
  status     text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','paid','failed')),
  message    text NOT NULL DEFAULT ''
);
CREATE INDEX ag_draws_invoice ON ag_draws (invoice_id);
-- Egna e-postmallar
CREATE TABLE email_templates (
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('invoice','reminder','thanks')),
  subject    text NOT NULL,
  body       text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, kind)
);
