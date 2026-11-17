-- HR-modulen: personaluppgifter och processer för onboarding, förflyttning och offboarding

CREATE TABLE hr_profiles (
  employee_id         integer PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  company_id          integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title               text NOT NULL DEFAULT '',
  department          text NOT NULL DEFAULT '',
  manager_employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  employment_type     text NOT NULL DEFAULT 'tillsvidare',
  phone               text NOT NULL DEFAULT '',
  emergency_contact   text NOT NULL DEFAULT '',
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_processes (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('onboarding','move','offboarding')),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  effective_date date NOT NULL,
  data           jsonb NOT NULL DEFAULT '{}',
  document_id    integer REFERENCES documents(id) ON DELETE SET NULL,
  created_by     integer NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_by   integer REFERENCES users(id),
  completed_at   timestamptz
);
CREATE INDEX hr_processes_company ON hr_processes(company_id, status);

CREATE TABLE hr_tasks (
  id          serial PRIMARY KEY,
  process_id  integer NOT NULL REFERENCES hr_processes(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  title       text NOT NULL,
  responsible text NOT NULL,                 -- HR, Chef, IT, Lön, Medarbetare
  due_date    date,
  auto_key    text,                          -- bockas av automatiskt, t.ex. 'document_signed'
  done        boolean NOT NULL DEFAULT false,
  done_by     integer REFERENCES users(id),
  done_at     timestamptz
);
