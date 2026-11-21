-- Revisionsberättelse som revisorn upprättar och signerar efter granskningen
CREATE TABLE IF NOT EXISTS audit_reports (
  engagement_id integer PRIMARY KEY REFERENCES audit_engagements(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opinion text NOT NULL CHECK (opinion IN ('clean','qualified','adverse','disclaimer')),
  basis text NOT NULL DEFAULT '',
  remarks text NOT NULL DEFAULT '',
  adopt boolean NOT NULL,
  discharge boolean NOT NULL,
  place text NOT NULL,
  signed_by integer REFERENCES users(id) ON DELETE SET NULL,
  signer_name text NOT NULL,
  signed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
