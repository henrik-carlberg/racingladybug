-- Intrastat: deklarationsrader per månad och flöde
CREATE TABLE IF NOT EXISTS intrastat_lines (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  flow text NOT NULL CHECK (flow IN ('arrival','dispatch')),
  kn text NOT NULL CHECK (kn ~ '^\d{8}$'),
  country text NOT NULL,
  origin text NOT NULL DEFAULT '',
  txn text NOT NULL,
  value bigint NOT NULL CHECK (value > 0),
  mass integer NOT NULL CHECK (mass >= 0),
  supp integer,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intrastat_lines_period ON intrastat_lines (company_id, period);
