-- Delbetalningar, förskottsfakturor och periodiseringar

ALTER TABLE invoices ADD COLUMN paid_amount bigint NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN advance boolean NOT NULL DEFAULT false;          -- förskottsfaktura (bokförs mot 2420)
ALTER TABLE invoices ADD COLUMN advance_settled_by integer REFERENCES invoices(id) ON DELETE SET NULL;
UPDATE invoices SET paid_amount = total WHERE status = 'paid';

CREATE TABLE invoice_payments (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id  integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  date        date NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  voucher_id  integer REFERENCES vouchers(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_payments_invoice ON invoice_payments (invoice_id);
-- Tidigare betalningar (hela beloppet) som egna rader
INSERT INTO invoice_payments (company_id, invoice_id, date, amount, voucher_id)
  SELECT company_id, id, paid_date, total, payment_voucher_id FROM invoices WHERE status = 'paid' AND paid_date IS NOT NULL AND total > 0;

ALTER TABLE supplier_invoices ADD COLUMN paid_amount bigint NOT NULL DEFAULT 0;
UPDATE supplier_invoices SET paid_amount = total WHERE status = 'paid';
CREATE TABLE supplier_invoice_payments (
  id                  serial PRIMARY KEY,
  company_id          integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_invoice_id integer NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  date                date NOT NULL,
  amount              bigint NOT NULL CHECK (amount > 0),
  voucher_id          integer REFERENCES vouchers(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_invoice_payments_invoice ON supplier_invoice_payments (supplier_invoice_id);
INSERT INTO supplier_invoice_payments (company_id, supplier_invoice_id, date, amount, voucher_id)
  SELECT company_id, id, paid_date, total, payment_voucher_id FROM supplier_invoices WHERE status = 'paid' AND paid_date IS NOT NULL;

-- Periodiseringar: ett belopp fördelas jämnt över månader (förutbetald kostnad/intäkt eller upplupen)
CREATE TABLE accruals (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  description     text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('prepaid_expense','prepaid_income')),
  amount          bigint NOT NULL CHECK (amount > 0),       -- hela beloppet exkl. moms
  result_account  integer NOT NULL,                         -- kostnads- eller intäktskonto
  balance_account integer NOT NULL,                         -- 1790 / 2990
  first_period    text NOT NULL,                            -- ÅÅÅÅ-MM
  months          integer NOT NULL CHECK (months BETWEEN 1 AND 120),
  source_voucher_id integer REFERENCES vouchers(id),
  cost_center_id  integer REFERENCES cost_centers(id),
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accrual_postings (
  accrual_id  integer NOT NULL REFERENCES accruals(id) ON DELETE CASCADE,
  period      text NOT NULL,
  amount      bigint NOT NULL,
  voucher_id  integer NOT NULL REFERENCES vouchers(id),
  PRIMARY KEY (accrual_id, period)
);
