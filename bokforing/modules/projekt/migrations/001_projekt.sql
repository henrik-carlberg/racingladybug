-- Projekt: plan, delmoment, uppgifter och kostnader ovanpå uppdragen (projects) i tidrapporteringen.
CREATE TABLE proj_details (
  project_id      integer PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  manager_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'on_hold', 'done')),
  start_date      date,
  end_date        date,
  budget_hours    numeric(10,2) NOT NULL DEFAULT 0,
  budget_revenue  bigint NOT NULL DEFAULT 0,   -- öre exkl. moms
  budget_cost     bigint NOT NULL DEFAULT 0,   -- externa kostnader, öre
  internal_rate   bigint NOT NULL DEFAULT 0,   -- intern kostnad per timme (lön + overhead), öre
  description     text NOT NULL DEFAULT ''
);

CREATE TABLE proj_milestones (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  due_date    date,
  amount      bigint NOT NULL DEFAULT 0,       -- belopp att fakturera när delmomentet är klart (0 = ingen fakturering)
  done        boolean NOT NULL DEFAULT false,
  done_at     date,
  invoice_id  integer REFERENCES invoices(id) ON DELETE SET NULL
);

CREATE TABLE proj_tasks (
  id               serial PRIMARY KEY,
  project_id       integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id     integer REFERENCES proj_milestones(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  assignee_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  estimate_minutes integer NOT NULL DEFAULT 0 CHECK (estimate_minutes >= 0),
  due_date         date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  done_at          timestamptz
);
CREATE INDEX proj_tasks_project ON proj_tasks(project_id, status);

ALTER TABLE time_entries ADD COLUMN task_id integer REFERENCES proj_tasks(id) ON DELETE SET NULL;

CREATE TABLE proj_costs (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date        date NOT NULL,
  amount      bigint NOT NULL,
  description text NOT NULL DEFAULT '',
  voucher_id  integer REFERENCES vouchers(id),
  account     integer,
  created_by  integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX proj_costs_voucher ON proj_costs(voucher_id, account) WHERE voucher_id IS NOT NULL;
