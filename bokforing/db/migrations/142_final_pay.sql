-- Slutlön när en anställning upphör
CREATE TABLE IF NOT EXISTS final_pays (
  employee_id integer PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  end_date date NOT NULL,
  reason text NOT NULL DEFAULT '',
  salary bigint NOT NULL,
  vacation bigint NOT NULL,
  vacation_days numeric(6,1) NOT NULL,
  advance bigint NOT NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
