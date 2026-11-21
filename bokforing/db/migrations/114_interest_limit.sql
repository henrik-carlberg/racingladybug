-- Ränteavdragsbegränsning: bolagets andel av förenklingsbeloppet (inom en intressegemenskap delas 5 miljoner kronor)
CREATE TABLE IF NOT EXISTS interest_limit_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  simplification bigint NOT NULL CHECK (simplification BETWEEN 0 AND 500000000),
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
