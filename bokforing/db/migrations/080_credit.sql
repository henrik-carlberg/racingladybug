-- Kreditkontroll: kreditgräns och riskklass per kund, upplysningar, bevakning och händelser
ALTER TABLE customers ADD COLUMN credit_limit bigint CHECK (credit_limit >= 0);
ALTER TABLE customers ADD COLUMN credit_policy text NOT NULL DEFAULT 'warn' CHECK (credit_policy IN ('warn','block'));
ALTER TABLE customers ADD COLUMN risk_class text CHECK (risk_class IN ('low','medium','high','stop'));
ALTER TABLE customers ADD COLUMN credit_monitor_id text;
CREATE TABLE credit_reports (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  at           timestamptz NOT NULL DEFAULT now(),
  provider_id  text NOT NULL DEFAULT '',
  score        integer,
  rating       text NOT NULL DEFAULT '',
  remarks      integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'active',
  recommended_limit bigint,
  reason       text NOT NULL DEFAULT 'manual',   -- manual, new_customer, monitor
  created_by   integer REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX credit_reports_customer ON credit_reports (customer_id, at DESC);
CREATE TABLE credit_events (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  at           timestamptz NOT NULL DEFAULT now(),
  kind         text NOT NULL,          -- remark, bankruptcy, rating_change, blocked_invoice, override
  message      text NOT NULL,
  seen         boolean NOT NULL DEFAULT false
);
CREATE INDEX credit_events_company ON credit_events (company_id, at DESC);
ALTER TABLE companies ADD COLUMN credit_check_new boolean NOT NULL DEFAULT false;  -- upplysning automatiskt på nya företagskunder
