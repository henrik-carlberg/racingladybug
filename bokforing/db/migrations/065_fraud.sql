-- Bedrägeri- och felskydd: ändrade bankuppgifter kräver godkännande, varningar för dubbletter och ovanliga transaktioner
CREATE TABLE supplier_bank_changes (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id   integer NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  old_values    jsonb NOT NULL,
  new_values    jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by  integer REFERENCES users(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    integer REFERENCES users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  comment       text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX supplier_bank_changes_pending ON supplier_bank_changes (supplier_id) WHERE status = 'pending';

CREATE TABLE risk_alerts (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('bank_change','duplicate','large','new_recipient','weekend')),
  entity      text NOT NULL,
  entity_id   integer NOT NULL,
  title       text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','ok','confirmed')),
  comment     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_by integer REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  UNIQUE (company_id, kind, entity, entity_id)
);
CREATE INDEX risk_alerts_open ON risk_alerts (company_id, status, created_at DESC);
