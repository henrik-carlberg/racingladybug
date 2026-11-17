-- E-faktura (Peppol), Swish och frånvaro i lönen.
ALTER TABLE customers ADD COLUMN peppol_id text NOT NULL DEFAULT '';   -- t.ex. 0007:5560269986 (organisationsnummer)
ALTER TABLE companies ADD COLUMN swish_number text NOT NULL DEFAULT '';

ALTER TABLE employees ADD COLUMN vacation_days integer NOT NULL DEFAULT 25;
ALTER TABLE employees ADD COLUMN hours_per_week numeric(5,2) NOT NULL DEFAULT 40;

CREATE TABLE absences (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('sick', 'vacation', 'vab', 'parental', 'leave')),
  from_date      date NOT NULL,
  to_date        date NOT NULL,
  extent         integer NOT NULL DEFAULT 100 CHECK (extent BETWEEN 1 AND 100),  -- procent av arbetstiden
  status         text NOT NULL DEFAULT 'approved' CHECK (status IN ('requested', 'approved', 'rejected')),
  note           text NOT NULL DEFAULT '',
  payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,           -- lönekörning där frånvaron har räknats
  created_by     integer REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX absences_employee ON absences(employee_id, from_date);

-- BIC för bolagets bankkonto (krävs av vissa banker i betalfilen)
ALTER TABLE companies ADD COLUMN bic text NOT NULL DEFAULT '';
