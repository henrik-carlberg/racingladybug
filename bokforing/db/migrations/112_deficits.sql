-- Underskottsavdrag: justerat skattemässigt resultat per år och ägarförändringar (belopps- och koncernbidragsspärr)
CREATE TABLE IF NOT EXISTS tax_results (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  taxable bigint NOT NULL,
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, fiscal_year_id)
);
CREATE TABLE IF NOT EXISTS ownership_changes (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  price bigint NOT NULL CHECK (price >= 0),
  contributions bigint NOT NULL DEFAULT 0 CHECK (contributions >= 0),
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
