-- SIE-import, tvåstegsverifiering och GDPR

CREATE TABLE sie_imports (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by  integer NOT NULL REFERENCES users(id),
  filename    text NOT NULL DEFAULT '',
  file_hash   text NOT NULL,
  data        jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','imported')),
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sie_imports_once ON sie_imports (company_id, file_hash) WHERE status = 'imported';

ALTER TABLE users
  ADD COLUMN totp_secret     text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN backup_codes    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN totp_last_step  bigint;

-- Inloggning som väntar på engångskod (efter rätt lösenord)
CREATE TABLE mfa_challenges (
  id         text PRIMARY KEY,                -- sha256 av token i cookie
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0
);

-- Personuppgiftsbiträdesavtal (GDPR art. 28) godkänt av bolagets ägare
ALTER TABLE companies
  ADD COLUMN dpa_accepted_at timestamptz,
  ADD COLUMN dpa_accepted_by integer REFERENCES users(id) ON DELETE SET NULL;

