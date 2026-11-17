-- Lönerevision: årlig översyn av lönerna med budget, förslag per medarbetare, godkännande och lönehistorik.
CREATE TABLE salary_reviews (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  effective_date date NOT NULL,                       -- ny lön gäller från
  budget_percent numeric(5,2) NOT NULL DEFAULT 0,     -- utrymme i procent av lönesumman (t.ex. "märket")
  criteria       text NOT NULL DEFAULT '',            -- lönekriterier / riktlinjer
  status         text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'approved', 'applied', 'cancelled')),
  created_by     integer NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  approved_by    integer REFERENCES users(id),
  approved_at    timestamptz,
  applied_by     integer REFERENCES users(id),
  applied_at     timestamptz
);
CREATE INDEX salary_reviews_company ON salary_reviews(company_id);

CREATE TABLE salary_review_items (
  id             serial PRIMARY KEY,
  review_id      integer NOT NULL REFERENCES salary_reviews(id) ON DELETE CASCADE,
  employee_id    integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  current_salary bigint NOT NULL,                     -- öre per månad när revisionen skapades
  new_salary     bigint NOT NULL,                     -- föreslagen månadslön
  comment        text NOT NULL DEFAULT '',            -- motivering (visas i lönebeskedet)
  retro_amount   bigint NOT NULL DEFAULT 0,           -- retroaktiv lön för redan utbetalda månader
  retro_paid_run integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  document_id    integer REFERENCES documents(id) ON DELETE SET NULL,
  UNIQUE (review_id, employee_id)
);

CREATE TABLE salary_history (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  old_salary     bigint NOT NULL,
  new_salary     bigint NOT NULL,
  review_id      integer REFERENCES salary_reviews(id) ON DELETE SET NULL,
  comment        text NOT NULL DEFAULT '',
  created_by     integer NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salary_history_employee ON salary_history(employee_id, effective_date);
