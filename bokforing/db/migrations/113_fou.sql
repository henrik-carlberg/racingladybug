-- Forskningsavdrag (FoU) i arbetsgivardeklarationen: arbetstid per lönespec och bokfört avdrag per lönekörning
CREATE TABLE IF NOT EXISTS fou_hours (
  payslip_id integer PRIMARY KEY REFERENCES payslips(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fou_hours numeric(7,2) NOT NULL CHECK (fou_hours >= 0),
  total_hours numeric(7,2) NOT NULL CHECK (total_hours >= 0),
  description text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS fou_deductions (
  run_id integer PRIMARY KEY REFERENCES payroll_runs(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  base bigint NOT NULL,
  amount bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
