-- Inlärd kontering: hur leverantörsfakturor och kvitton brukar konteras.
-- streak = antal gånger i rad med exakt samma kontering; förslag visas från två.
CREATE TABLE coding_memory (
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('supplier','receipt')),
  key        text NOT NULL,
  data       jsonb NOT NULL,
  streak     int NOT NULL DEFAULT 1,
  uses       int NOT NULL DEFAULT 1,
  last_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, kind, key)
);
