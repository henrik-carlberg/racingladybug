-- Styrelsearvoden: ledamöter per stämmoperiod och utbetalningar
CREATE TABLE IF NOT EXISTS board_members (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  id_number text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'ledamot',
  agm_date date NOT NULL,
  annual_fee bigint NOT NULL DEFAULT 0 CHECK (annual_fee >= 0),
  mode text NOT NULL CHECK (mode IN ('salary','invoice')),
  recipient text NOT NULL DEFAULT 'person' CHECK (recipient IN ('person','company')),
  f_skatt boolean NOT NULL DEFAULT false,
  in_business boolean NOT NULL DEFAULT false,
  employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS board_fee_payments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  member_id integer NOT NULL REFERENCES board_members(id) ON DELETE CASCADE,
  date date NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  tax bigint NOT NULL DEFAULT 0,
  fee bigint NOT NULL DEFAULT 0,
  via text NOT NULL CHECK (via IN ('payroll','invoice')),
  run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
