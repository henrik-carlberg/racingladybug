-- Betalningar direkt via bankens API (betalinitiering med BankID)
CREATE TABLE bank_payments (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('supplier','salary')),
  payroll_run_id  integer REFERENCES payroll_runs(id) ON DELETE SET NULL,
  bank_account_id integer NOT NULL REFERENCES bank_accounts(id),
  external_id     text,
  status          text NOT NULL CHECK (status IN ('authorization','accepted','executed','rejected','failed')),
  message         text NOT NULL DEFAULT '',
  execution_date  date NOT NULL,
  total           bigint NOT NULL,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_payments_company ON bank_payments (company_id, created_at DESC);
CREATE TABLE bank_payment_items (
  id                  serial PRIMARY KEY,
  payment_id          integer NOT NULL REFERENCES bank_payments(id) ON DELETE CASCADE,
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  payslip_id          integer REFERENCES payslips(id) ON DELETE SET NULL,
  name                text NOT NULL,
  account             text NOT NULL,
  reference           text NOT NULL DEFAULT '',
  amount              bigint NOT NULL,
  voucher_id          integer REFERENCES vouchers(id) ON DELETE SET NULL
);
CREATE TABLE bank_payment_states (
  state       text PRIMARY KEY,
  payment_id  integer NOT NULL REFERENCES bank_payments(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
