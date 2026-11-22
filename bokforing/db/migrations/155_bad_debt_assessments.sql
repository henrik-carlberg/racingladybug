-- Individuell bedömning av osäkra kundfordringar (andel som befaras gå förlorad)
CREATE TABLE IF NOT EXISTS bad_debt_assessments (
  invoice_id integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  pct numeric(5,2) NOT NULL CHECK (pct >= 0 AND pct <= 100),
  note text NOT NULL,
  assessed_by integer REFERENCES users(id),
  assessed_at timestamptz NOT NULL DEFAULT now()
);
