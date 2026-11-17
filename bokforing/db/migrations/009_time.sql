-- Tidrapportering: uppdrag per kund med aktiviteter, tidrader, fakturaunderlag och timbank.
CREATE TABLE projects (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id),
  name        text NOT NULL,
  billing     text NOT NULL DEFAULT 'hourly' CHECK (billing IN ('hourly', 'hour_bank', 'fixed', 'internal')),
  hourly_rate bigint NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0), -- öre per timme exkl. moms
  vat_rate    integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  active      boolean NOT NULL DEFAULT true,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_company ON projects(company_id);

CREATE TABLE project_activities (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  hourly_rate bigint CHECK (hourly_rate >= 0), -- null = uppdragets timpris
  billable    boolean NOT NULL DEFAULT true,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (project_id, name)
);

ALTER TABLE invoices ADD COLUMN project_id integer REFERENCES projects(id);
-- Timbanksavräkning: { period, purchased, drawn_before, used_now, drawn, overage, remaining } i minuter
ALTER TABLE invoices ADD COLUMN hour_bank jsonb;

CREATE TABLE time_entries (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  integer NOT NULL REFERENCES projects(id),
  activity_id integer NOT NULL REFERENCES project_activities(id),
  user_id     integer NOT NULL REFERENCES users(id),
  date        date NOT NULL,
  minutes     integer NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description text NOT NULL DEFAULT '',
  billable    boolean NOT NULL DEFAULT true,
  invoice_id  integer REFERENCES invoices(id) ON DELETE SET NULL, -- fakturaunderlag eller timbanksavräkning
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX time_entries_project ON time_entries(project_id, date);
CREATE INDEX time_entries_user ON time_entries(company_id, user_id, date);
CREATE INDEX time_entries_invoice ON time_entries(invoice_id);

-- Köp av timbank. Försvinner om fakturautkastet tas bort.
CREATE TABLE hour_bank_purchases (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date        date NOT NULL,
  minutes     integer NOT NULL CHECK (minutes > 0),
  invoice_id  integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
