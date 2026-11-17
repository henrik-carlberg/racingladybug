-- CRM: säljpipeline med steg, affärer, offertrader och stegshistorik.
CREATE TABLE crm_stages (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  probability integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  position    integer NOT NULL DEFAULT 0,
  kind        text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  active      boolean NOT NULL DEFAULT true
);
CREATE INDEX crm_stages_company ON crm_stages(company_id, position);

CREATE TABLE crm_deals (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title          text NOT NULL,
  customer_id    integer REFERENCES customers(id) ON DELETE SET NULL,
  prospect_name  text NOT NULL DEFAULT '',        -- företag som ännu inte är kund
  contact_name   text NOT NULL DEFAULT '',
  contact_email  text NOT NULL DEFAULT '',
  value          bigint NOT NULL DEFAULT 0,       -- öre exkl. moms
  stage_id       integer NOT NULL REFERENCES crm_stages(id),
  probability    integer CHECK (probability BETWEEN 0 AND 100), -- null = stegets sannolikhet
  expected_close date,
  owner_user_id  integer REFERENCES users(id) ON DELETE SET NULL,
  source         text NOT NULL DEFAULT '',
  next_step      text NOT NULL DEFAULT '',
  lost_reason    text NOT NULL DEFAULT '',
  closed_at      date,
  quote_valid_to date,
  quote_notes    text NOT NULL DEFAULT '',
  document_id    integer REFERENCES documents(id) ON DELETE SET NULL,
  invoice_id     integer REFERENCES invoices(id) ON DELETE SET NULL,
  project_id     integer REFERENCES projects(id) ON DELETE SET NULL,
  created_by     integer NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_deals_company ON crm_deals(company_id, stage_id);

CREATE TABLE crm_quote_lines (
  id          serial PRIMARY KEY,
  deal_id     integer NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  description text NOT NULL,
  quantity    numeric(12,3) NOT NULL DEFAULT 1,
  unit        text NOT NULL DEFAULT 'st',
  unit_price  bigint NOT NULL DEFAULT 0,
  vat_rate    integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25))
);

CREATE TABLE crm_stage_history (
  id         serial PRIMARY KEY,
  deal_id    integer NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  from_stage integer REFERENCES crm_stages(id) ON DELETE SET NULL,
  to_stage   integer NOT NULL REFERENCES crm_stages(id) ON DELETE CASCADE,
  changed_by integer REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm_activities ADD COLUMN deal_id integer REFERENCES crm_deals(id) ON DELETE CASCADE;
