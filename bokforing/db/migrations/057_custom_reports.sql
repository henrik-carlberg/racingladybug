-- Egna rapporter och delade länkar (rapporter och nyckeltal för banken eller styrelsen)
CREATE TABLE custom_reports (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  definition  jsonb NOT NULL,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE report_shares (
  id          serial PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('report','kpi')),
  report_id   integer REFERENCES custom_reports(id) ON DELETE CASCADE,
  role        text,
  label       text NOT NULL DEFAULT '',
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  views       integer NOT NULL DEFAULT 0,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
