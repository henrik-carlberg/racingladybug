-- Kvitterade kvalitetskontroller före bokslut (med förklaring)
CREATE TABLE IF NOT EXISTS quality_acks (
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id INT NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  note TEXT NOT NULL,
  acked_by INT REFERENCES users(id) ON DELETE SET NULL,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, fiscal_year_id, key)
);
