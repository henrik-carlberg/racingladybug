-- Budget per kostnadsställe eller projekt och månad
CREATE TABLE IF NOT EXISTS dim_budgets (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  dim text NOT NULL CHECK (dim IN ('cost_center','project')),
  dim_id integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cost','revenue')),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount bigint NOT NULL,
  PRIMARY KEY (company_id, year, dim, dim_id, kind, month)
);
