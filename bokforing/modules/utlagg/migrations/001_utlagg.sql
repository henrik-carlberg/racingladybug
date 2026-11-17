-- Utlägg och reseräkningar: kvitton, milersättning och traktamente som attesteras, bokförs och betalas ut via lönen.
CREATE TABLE exp_settings (
  company_id        integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  mileage_rate      bigint NOT NULL DEFAULT 2500,   -- öre per mil, skattefri milersättning egen bil
  allowance_full    bigint NOT NULL DEFAULT 30000,  -- öre, traktamente hel dag inrikes
  allowance_half    bigint NOT NULL DEFAULT 15000,  -- öre, halv dag
  allowance_night   bigint NOT NULL DEFAULT 15000,  -- öre, nattraktamente
  liability_account integer NOT NULL DEFAULT 2820,
  mileage_account   integer NOT NULL DEFAULT 7331,
  allowance_account integer NOT NULL DEFAULT 7321
);

CREATE TABLE exp_claims (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    integer NOT NULL REFERENCES employees(id),
  title          text NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  comment        text NOT NULL DEFAULT '',
  created_by     integer NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  approved_by    integer REFERENCES users(id),
  approved_at    timestamptz,
  voucher_id     integer REFERENCES vouchers(id),
  payroll_run_id integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  paid_voucher_id integer REFERENCES vouchers(id)
);
CREATE INDEX exp_claims_company ON exp_claims(company_id, status);

CREATE TABLE exp_lines (
  id            serial PRIMARY KEY,
  claim_id      integer NOT NULL REFERENCES exp_claims(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('receipt', 'mileage', 'allowance')),
  date          date NOT NULL,
  description   text NOT NULL,
  amount        bigint NOT NULL,           -- öre att ersätta (kvitto inkl. moms)
  vat           bigint NOT NULL DEFAULT 0, -- avdragsgill ingående moms
  account       integer NOT NULL,
  km            numeric(10,1),
  days_full     integer,
  days_half     integer,
  nights        integer,
  attachment_id integer REFERENCES attachments(id) ON DELETE SET NULL
);
