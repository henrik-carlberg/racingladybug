-- Lön del 2: skattefria förmåner med tak, flextid och tidbank, semesterlöneskuld automatiskt vid lönebokning
CREATE TABLE benefit_payments (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('wellness','christmas','anniversary','memorial')),
  date            date NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  description     text NOT NULL DEFAULT '',
  payroll_run_id  integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX benefit_payments_emp ON benefit_payments (company_id, employee_id, date);
ALTER TABLE employees ADD COLUMN flex_start date;
CREATE TABLE flex_adjustments (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date            date NOT NULL,
  minutes         integer NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('adjust','payout','leave')),
  note            text NOT NULL DEFAULT '',
  payroll_run_id  integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE companies ADD COLUMN vacation_liability_auto boolean NOT NULL DEFAULT false;
