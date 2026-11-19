-- Lån med amorteringsplan, krediter och factoring
CREATE TABLE loans (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  lender          text NOT NULL DEFAULT '',
  principal       bigint NOT NULL CHECK (principal > 0),
  rate_pct        numeric(6,3) NOT NULL CHECK (rate_pct >= 0 AND rate_pct < 100),
  type            text NOT NULL CHECK (type IN ('straight','annuity')),
  first_date      date NOT NULL,
  months          integer NOT NULL CHECK (months BETWEEN 1 AND 600),
  loan_account    integer NOT NULL DEFAULT 2350,
  bank_account    integer NOT NULL DEFAULT 1930,
  disbursement_voucher_id integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE loan_rows (
  loan_id       integer NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  n             integer NOT NULL,
  date          date NOT NULL,
  interest      bigint NOT NULL,
  amortization  bigint NOT NULL,
  balance       bigint NOT NULL,
  voucher_id    integer REFERENCES vouchers(id) ON DELETE SET NULL,
  PRIMARY KEY (loan_id, n)
);
CREATE TABLE credit_lines (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  bank_account_id integer REFERENCES bank_accounts(id) ON DELETE SET NULL,
  credit_limit    bigint NOT NULL CHECK (credit_limit > 0),
  rate_pct        numeric(6,3),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE factoring_deals (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id   integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  external_id  text,
  status       text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','funded','rejected','cancelled')),
  amount       bigint NOT NULL,
  advance      bigint,
  fee          bigint,
  message      text NOT NULL DEFAULT '',
  voucher_id   integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX factoring_deals_invoice ON factoring_deals (invoice_id) WHERE status IN ('offered','accepted','funded');
CREATE UNIQUE INDEX factoring_deals_external ON factoring_deals (external_id) WHERE external_id IS NOT NULL;
