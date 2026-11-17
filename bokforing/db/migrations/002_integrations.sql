-- API-nycklar, händelser (outbox), webhooks, idempotens och moduler.

CREATE TABLE api_keys (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,              -- första tecknen, för att känna igen nyckeln
  token_hash   text NOT NULL UNIQUE,       -- sha256 av hela nyckeln
  scopes       text[] NOT NULL,
  created_by   integer NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- Spårbarhet: vilken API-nyckel som utförde en ändring
ALTER TABLE audit_log ADD COLUMN api_key_id integer REFERENCES api_keys(id);
ALTER TABLE vouchers  ADD COLUMN api_key_id integer REFERENCES api_keys(id);

-- Händelselogg. Skrivs i samma transaktion som ändringen (outbox-mönster).
CREATE TABLE events (
  id         bigserial PRIMARY KEY,
  public_id  text NOT NULL UNIQUE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type       text NOT NULL,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_company ON events(company_id, id);

CREATE TABLE webhook_endpoints (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url         text NOT NULL,
  description text NOT NULL DEFAULT '',
  secret      text NOT NULL,              -- används för HMAC-signering
  events      text[] NOT NULL,            -- händelsetyper, eller '*' för alla
  active      boolean NOT NULL DEFAULT true,
  created_by  integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id               bigserial PRIMARY KEY,
  endpoint_id      integer NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id         bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_attempt_at  timestamptz,
  last_status_code integer,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries(next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id, id DESC);

-- Idempotency-Key för POST-anrop i API:t (skyddar mot dubbelbokning vid omförsök)
CREATE TABLE idempotency_keys (
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key          text NOT NULL,
  request_hash text NOT NULL,
  status       integer,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

-- Vilka tilläggsmoduler som är aktiverade per bolag
CREATE TABLE company_modules (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module_id  text NOT NULL,
  settings   jsonb NOT NULL DEFAULT '{}',
  enabled_by integer REFERENCES users(id),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, module_id)
);
