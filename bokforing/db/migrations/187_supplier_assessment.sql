-- Leverantörsbedömning: risknivå per leverantör, kontroller med giltighetstid (F-skatt, moms, kreditupplysning, försäkring, kollektivavtal, uppförandekod) och varningar vid fakturor
CREATE TABLE IF NOT EXISTS supplier_risk (
  supplier_id integer PRIMARY KEY REFERENCES suppliers(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'low' CHECK (level IN ('low','medium','high')),
  note text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS supplier_checks (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id integer NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('f_tax','vat','credit','insurance','collective','code_of_conduct')),
  checked_on date NOT NULL,
  valid_until date NOT NULL,
  ok boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id),
  CHECK (valid_until >= checked_on)
);
CREATE INDEX IF NOT EXISTS supplier_checks_supplier ON supplier_checks (company_id, supplier_id, kind, checked_on DESC);
