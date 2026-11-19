-- OAuth 2 för tredjepartsappar och logg över API-anrop
CREATE TABLE oauth_apps (
  id             serial PRIMARY KEY,
  client_id      text NOT NULL UNIQUE,
  secret_hash    text,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  homepage       text NOT NULL DEFAULT '',
  redirect_uris  text[] NOT NULL,
  owner_user_id  integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);
CREATE TABLE oauth_codes (
  code_hash      text PRIMARY KEY,
  app_id         integer NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  user_id        integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  scopes         text[] NOT NULL,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);
CREATE TABLE oauth_grants (
  id           serial PRIMARY KEY,
  app_id       integer NOT NULL REFERENCES oauth_apps(id) ON DELETE CASCADE,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes       text[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE UNIQUE INDEX oauth_grants_active ON oauth_grants (app_id, company_id) WHERE revoked_at IS NULL;
CREATE TABLE oauth_tokens (
  token_hash  text PRIMARY KEY,
  grant_id    integer NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('access','refresh')),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id);
ALTER TABLE webhook_endpoints ADD COLUMN oauth_grant_id integer REFERENCES oauth_grants(id) ON DELETE CASCADE;
CREATE TABLE api_requests (
  id             bigserial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  api_key_id     integer REFERENCES api_keys(id) ON DELETE SET NULL,
  oauth_grant_id integer REFERENCES oauth_grants(id) ON DELETE SET NULL,
  method         text NOT NULL,
  path           text NOT NULL,
  status         integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_requests_company ON api_requests (company_id, created_at DESC);
