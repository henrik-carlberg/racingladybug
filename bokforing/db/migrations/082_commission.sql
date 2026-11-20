-- Provisioner och säljbonus: säljare (anställda eller agenter), regler, bonustrappor och periodens avräkning
CREATE TABLE commission_sellers (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('employee','agent')),
  employee_id   integer REFERENCES employees(id) ON DELETE SET NULL,
  supplier_id   integer REFERENCES suppliers(id) ON DELETE SET NULL,
  base_rate     numeric(5,2) NOT NULL DEFAULT 0 CHECK (base_rate >= 0 AND base_rate <= 100),
  target        bigint,           -- månadsmål (försäljning exkl. moms)
  target_bonus  bigint,           -- bonus när målet nås
  agent_vat     boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  CHECK ((kind = 'employee' AND employee_id IS NOT NULL) OR (kind = 'agent' AND supplier_id IS NOT NULL))
);
CREATE TABLE commission_rules (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  seller_id     integer REFERENCES commission_sellers(id) ON DELETE CASCADE,
  scope         text NOT NULL CHECK (scope IN ('customer','account')),
  customer_id   integer REFERENCES customers(id) ON DELETE CASCADE,
  account       integer,
  rate_pct      numeric(5,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100)
);
CREATE TABLE commission_tiers (
  id            serial PRIMARY KEY,
  seller_id     integer NOT NULL REFERENCES commission_sellers(id) ON DELETE CASCADE,
  threshold     bigint NOT NULL CHECK (threshold >= 0),
  rate_pct      numeric(5,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100)
);
ALTER TABLE customers ADD COLUMN seller_id integer REFERENCES commission_sellers(id) ON DELETE SET NULL;
CREATE TABLE invoice_sellers (
  invoice_id    integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  seller_id     integer NOT NULL REFERENCES commission_sellers(id) ON DELETE CASCADE
);
CREATE TABLE commission_runs (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  seller_id     integer NOT NULL REFERENCES commission_sellers(id) ON DELETE CASCADE,
  period        text NOT NULL,
  basis         bigint NOT NULL,
  commission    bigint NOT NULL,
  bonus         bigint NOT NULL,
  total         bigint NOT NULL,
  details       jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','transferred')),
  payslip_id    integer REFERENCES payslips(id) ON DELETE SET NULL,
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  transferred_at timestamptz,
  UNIQUE (seller_id, period)
);
