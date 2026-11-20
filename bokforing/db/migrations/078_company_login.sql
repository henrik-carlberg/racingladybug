-- Företagsinloggning: SSO per bolag, krav på tvåstegsverifiering, IP-begränsning, sessioner och inloggningslogg
ALTER TABLE sessions ADD COLUMN method text NOT NULL DEFAULT 'password';
ALTER TABLE sessions ADD COLUMN mfa boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN ip text;
ALTER TABLE sessions ADD COLUMN user_agent text;
CREATE INDEX sessions_user ON sessions (user_id);
ALTER TABLE companies ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN ip_allowlist text[] NOT NULL DEFAULT '{}';
CREATE TABLE company_sso (
  company_id    integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('entra','google','oidc')),
  issuer        text NOT NULL,
  client_id     text NOT NULL,
  client_secret text NOT NULL,          -- krypterad
  domains       text[] NOT NULL,
  enforce       boolean NOT NULL DEFAULT false,  -- medlemmar med domänen måste logga in med SSO
  idp_mfa       boolean NOT NULL DEFAULT false,  -- lita på att leverantören kräver tvåstegsverifiering
  enabled       boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_sso_domains ON company_sso USING gin (domains);
CREATE TABLE sso_flows (
  state_hash    text PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  nonce         text NOT NULL,
  verifier      text NOT NULL,
  email         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE login_events (
  id            bigserial PRIMARY KEY,
  user_id       integer REFERENCES users(id) ON DELETE CASCADE,
  email         text NOT NULL DEFAULT '',
  at            timestamptz NOT NULL DEFAULT now(),
  method        text NOT NULL,
  success       boolean NOT NULL,
  reason        text NOT NULL DEFAULT '',
  ip            text,
  user_agent    text
);
CREATE INDEX login_events_user ON login_events (user_id, at DESC);
CREATE TABLE session_company_blocks (
  session_id    text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  blocked_by    integer REFERENCES users(id) ON DELETE SET NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, company_id)
);
