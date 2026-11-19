-- Resultat av den nattliga integritetskontrollen per bolag
CREATE TABLE integrity_runs (
  id         bigserial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_at     timestamptz NOT NULL DEFAULT now(),
  errors     int NOT NULL,
  warnings   int NOT NULL,
  issues     jsonb NOT NULL
);
CREATE INDEX integrity_runs_company ON integrity_runs (company_id, run_at DESC);
