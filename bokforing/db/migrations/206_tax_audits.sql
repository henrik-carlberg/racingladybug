-- Skatterevision och omprövning: Skatteverkets revisioner och förfrågningar, begärda handlingar med frist, beslut, bokföring och överklagande
CREATE TABLE IF NOT EXISTS tax_audits (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('revision', 'inquiry')),
  subject text NOT NULL CHECK (subject IN ('income', 'vat', 'payroll', 'other')),
  tax_year integer NOT NULL,
  reference text NOT NULL DEFAULT '',
  opened_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'appealed', 'closed')),
  memo_on date,
  decision_on date,
  tax_amount bigint NOT NULL DEFAULT 0,
  surcharge bigint NOT NULL DEFAULT 0,
  interest bigint NOT NULL DEFAULT 0,
  disputed boolean NOT NULL DEFAULT false,
  appeal_deadline date,
  appealed_on date,
  outcome text NOT NULL DEFAULT '',
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS tax_audit_requests (
  id serial PRIMARY KEY,
  audit_id integer NOT NULL REFERENCES tax_audits(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item text NOT NULL,
  due_date date NOT NULL,
  answered_on date,
  note text NOT NULL DEFAULT ''
);
