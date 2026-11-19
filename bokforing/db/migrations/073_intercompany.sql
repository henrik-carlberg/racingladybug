-- Koncerninterna flöden: speglade fakturor och återkommande koncernavgifter
CREATE TABLE intercompany_invoices (
  id                   serial PRIMARY KEY,
  source_company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id           integer NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  target_company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_invoice_id  integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  message              text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE intercompany_charges (
  id                 serial PRIMARY KEY,
  company_id         integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  target_company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('management_fee','interest')),
  amount             bigint,
  principal          bigint,
  rate_pct           numeric(6,3),
  start_period       text NOT NULL CHECK (start_period ~ '^\d{4}-\d{2}$'),
  last_period        text,
  active             boolean NOT NULL DEFAULT true,
  created_by         integer REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- Mottagaren måste själv tillåta att koncernbolag lägger in leverantörsfakturor hos den
ALTER TABLE companies ADD COLUMN accept_intercompany boolean NOT NULL DEFAULT false;
