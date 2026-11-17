-- Passkeys (WebAuthn). En användare kan ha flera (telefon, dator, säkerhetsnyckel).

ALTER TABLE users ADD COLUMN webauthn_id text UNIQUE;  -- slumpat användar-id till autentiseraren (inte e-post/db-id)

CREATE TABLE passkeys (
  id            text PRIMARY KEY,           -- credential id (base64url)
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[] NOT NULL DEFAULT '{}',
  device_type   text NOT NULL,              -- singleDevice | multiDevice (synkad passkey)
  backed_up     boolean NOT NULL DEFAULT false,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkeys_user ON passkeys(user_id);

-- Engångs-challenges, kopplade till webbläsaren via en httpOnly-cookie
CREATE TABLE webauthn_challenges (
  id         text PRIMARY KEY,
  challenge  text NOT NULL,
  purpose    text NOT NULL CHECK (purpose IN ('register','login')),
  user_id    integer REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
