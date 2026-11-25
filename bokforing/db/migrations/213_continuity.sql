-- Kontinuitetsplan: kritiska uppgifter med ansvarig och ersättare, kontakter vid kris och årlig genomgång
CREATE TABLE IF NOT EXISTS continuity_plans (
  company_id    integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  crisis_routine text NOT NULL DEFAULT '',
  reviewed_on   date,
  reviewed_by   integer REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS continuity_tasks (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  permission     text CHECK (permission IN ('invoicing', 'purchasing', 'attest', 'payments', 'payroll', 'ledger')),
  responsible_id integer REFERENCES users(id) ON DELETE SET NULL,
  substitute_id  integer REFERENCES users(id) ON DELETE SET NULL,
  routine        text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS continuity_tasks_company ON continuity_tasks (company_id);
CREATE TABLE IF NOT EXISTS continuity_contacts (
  id         serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  role       text NOT NULL DEFAULT '',
  phone      text NOT NULL DEFAULT '',
  email      text NOT NULL DEFAULT '',
  notes      text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS continuity_contacts_company ON continuity_contacts (company_id);
