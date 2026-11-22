-- Löneutmätning enligt beslut från Kronofogden
CREATE TABLE IF NOT EXISTS wage_garnishments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  case_no text NOT NULL,
  monthly_amount bigint NOT NULL CHECK (monthly_amount > 0),
  reserved_amount bigint NOT NULL CHECK (reserved_amount >= 0),
  valid_from date NOT NULL,
  ended_on date,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS garnishment_deductions (
  id serial PRIMARY KEY,
  garnishment_id integer NOT NULL REFERENCES wage_garnishments(id) ON DELETE CASCADE,
  run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount >= 0),
  paid_voucher_id integer REFERENCES vouchers(id),
  UNIQUE (garnishment_id, run_id)
);
