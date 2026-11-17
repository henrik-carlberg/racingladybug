-- Marknadsföring: kampanjer, kostnader kopplade till bokföringen, leads med samtycke och marknadsbudget.
CREATE TABLE mkt_campaigns (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  channel     text NOT NULL DEFAULT 'other',
  start_date  date NOT NULL,
  end_date    date,
  budget      bigint NOT NULL DEFAULT 0,      -- öre exkl. moms
  goal        text NOT NULL DEFAULT '',
  code        text NOT NULL DEFAULT '',       -- kampanjkod / utm_campaign
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'done')),
  created_by  integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mkt_campaigns_company ON mkt_campaigns(company_id);

CREATE TABLE mkt_costs (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL REFERENCES mkt_campaigns(id) ON DELETE CASCADE,
  date        date NOT NULL,
  amount      bigint NOT NULL,                -- öre exkl. moms
  description text NOT NULL DEFAULT '',
  voucher_id  integer REFERENCES vouchers(id),
  account     integer,                        -- konto i verifikationen som kostnaden hämtades från
  created_by  integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mkt_costs_voucher ON mkt_costs(voucher_id, account) WHERE voucher_id IS NOT NULL;

CREATE TABLE mkt_leads (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id  integer REFERENCES mkt_campaigns(id) ON DELETE SET NULL,
  name         text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  email        text NOT NULL DEFAULT '',
  phone        text NOT NULL DEFAULT '',
  source       text NOT NULL DEFAULT '',      -- t.ex. webbformulär, mässa, rekommendation
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost')),
  value        bigint NOT NULL DEFAULT 0,     -- uppskattat affärsvärde, öre
  consent      boolean NOT NULL DEFAULT false, -- samtycke till marknadsföring (GDPR)
  consent_text text NOT NULL DEFAULT '',
  consent_at   timestamptz,
  notes        text NOT NULL DEFAULT '',
  customer_id  integer REFERENCES customers(id) ON DELETE SET NULL,
  won_at       date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mkt_leads_company ON mkt_leads(company_id, status);

CREATE TABLE mkt_budgets (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year       integer NOT NULL,
  month      integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, year, month)
);
