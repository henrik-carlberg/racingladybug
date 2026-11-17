-- Manuellt avbockade deadlines och uppgifter till årsredovisning/årsbokslut

CREATE TABLE deadline_marks (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        text NOT NULL,
  done_by    integer NOT NULL REFERENCES users(id),
  done_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

CREATE TABLE yearend_reports (
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  data           jsonb NOT NULL DEFAULT '{}',
  updated_by     integer REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, fiscal_year_id)
);
