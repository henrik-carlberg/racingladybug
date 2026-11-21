-- Lån till anställda med avdrag på nettolönen och ränteförmån
CREATE TABLE IF NOT EXISTS employee_loans (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  principal bigint NOT NULL CHECK (principal > 0),
  agreed_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (agreed_rate >= 0 AND agreed_rate < 50),
  installment bigint NOT NULL CHECK (installment > 0),
  loan_date date NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS employee_loan_installments (
  id serial PRIMARY KEY,
  loan_id integer NOT NULL REFERENCES employee_loans(id) ON DELETE CASCADE,
  run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  amortization bigint NOT NULL,
  interest bigint NOT NULL,
  benefit bigint NOT NULL,
  UNIQUE (loan_id, run_id)
);
