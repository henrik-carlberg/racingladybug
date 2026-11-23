-- Anbud och ramavtal: anbudsregister med kalkyl och utfall, ramavtal med takbelopp och avtalsperiod, avrop (fakturor) mot avtalet
CREATE TABLE IF NOT EXISTS tenders (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date NOT NULL,
  cost bigint NOT NULL DEFAULT 0 CHECK (cost >= 0), -- kalkylerad kostnad
  bid bigint NOT NULL CHECK (bid > 0), -- anbudssumma exkl. moms
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','won','lost','withdrawn')),
  decided_on date,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS framework_agreements (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tender_id integer REFERENCES tenders(id) ON DELETE SET NULL,
  name text NOT NULL,
  cap bigint NOT NULL CHECK (cap > 0), -- takbelopp exkl. moms
  start_date date NOT NULL,
  end_date date NOT NULL,
  warn_pct integer NOT NULL DEFAULT 80 CHECK (warn_pct BETWEEN 1 AND 100),
  created_by integer REFERENCES users(id),
  CHECK (end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS framework_calls (
  agreement_id integer NOT NULL REFERENCES framework_agreements(id) ON DELETE CASCADE,
  invoice_id integer NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  PRIMARY KEY (agreement_id, invoice_id)
);
