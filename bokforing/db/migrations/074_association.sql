-- Föreningar: medlemsregister, medlemsavgifter, gåvor och bidrag, årsmöten
ALTER TABLE companies ADD COLUMN org_form text CHECK (org_form IN ('ideell'));
CREATE TABLE members (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  member_no   integer NOT NULL,
  name        text NOT NULL,
  email       text NOT NULL DEFAULT '',
  phone       text NOT NULL DEFAULT '',
  address     text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'Ordinarie',
  joined      date NOT NULL,
  left_on     date,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, member_no)
);
CREATE TABLE member_fee_rates (
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  category    text NOT NULL,
  amount      bigint NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (company_id, year, category)
);
CREATE TABLE member_fees (
  member_id   integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  amount      bigint NOT NULL,
  invoice_id  integer REFERENCES invoices(id) ON DELETE SET NULL,
  PRIMARY KEY (member_id, year)
);
CREATE TABLE assoc_gifts (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('gift','grant')),
  date        date NOT NULL,
  donor       text NOT NULL,
  amount      bigint NOT NULL CHECK (amount > 0),
  purpose     text NOT NULL DEFAULT '',
  restricted  boolean NOT NULL DEFAULT false,
  voucher_id  integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assoc_gifts_company ON assoc_gifts (company_id, date);
CREATE TABLE assoc_meetings (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  date        date NOT NULL,
  time        text NOT NULL DEFAULT '18:00',
  place       text NOT NULL DEFAULT '',
  notice_sent_at timestamptz,
  notice_count integer NOT NULL DEFAULT 0,
  report_doc_id integer REFERENCES documents(id) ON DELETE SET NULL,
  audit_doc_id  integer REFERENCES documents(id) ON DELETE SET NULL,
  UNIQUE (company_id, year)
);
