-- Inlämningar till myndigheter (moms, AGI, årsredovisning): fil eller API, status och kvittens
CREATE TABLE filings (
  id           serial PRIMARY KEY,
  company_id   int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('moms','agi','arsredovisning')),
  period       text NOT NULL,                -- t.ex. 2026-07-01:2026-09-30, 2026-10 eller räkenskapsårets slutdatum
  deadline_key text NOT NULL,
  ref_id       int,                          -- lönekörning eller räkenskapsår
  filename     text NOT NULL,
  payload      text NOT NULL,
  sha256       text NOT NULL,
  status       text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','submitted','accepted','rejected')),
  method       text CHECK (method IN ('api','file')),
  external_id  text,
  receipt      text,                         -- kvittensnummer eller referens från myndigheten
  message      text NOT NULL DEFAULT '',
  created_by   int REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  decided_at   timestamptz
);
CREATE INDEX filings_company ON filings (company_id, created_at DESC);
