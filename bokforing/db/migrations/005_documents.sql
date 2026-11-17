-- Dokument och e-signering

ALTER TABLE webauthn_challenges DROP CONSTRAINT webauthn_challenges_purpose_check;
ALTER TABLE webauthn_challenges ADD CONSTRAINT webauthn_challenges_purpose_check CHECK (purpose IN ('register','login','sign'));
ALTER TABLE webauthn_challenges ADD COLUMN ref text;  -- t.ex. signer-id vid signering

CREATE TABLE documents (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title         text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('html','pdf')),
  html          text,                           -- dokumentets innehåll (kind = html)
  file          bytea,                          -- PDF (kind = pdf)
  filename      text,
  sha256        text NOT NULL,                  -- hash av innehållet som signeras
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','completed','declined','cancelled')),
  message       text NOT NULL DEFAULT '',       -- meddelande till undertecknarna
  source_module text,                           -- t.ex. 'hr'
  source_id     integer,
  seal          text,                           -- HMAC över signeringsbeviset när alla signerat
  created_by    integer NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE TABLE document_signers (
  id            serial PRIMARY KEY,
  document_id   integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  name          text NOT NULL,
  email         text NOT NULL DEFAULT '',
  user_id       integer REFERENCES users(id),   -- intern undertecknare (signerar inloggad)
  token_hash    text UNIQUE,                    -- extern undertecknare (signerar via länk)
  token_enc     text,                           -- krypterad länk-token så att avsändaren kan visa länken igen
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','declined')),
  method        text,                           -- passkey | password | link
  signed_name   text,
  signed_at     timestamptz,
  ip            text,
  user_agent    text,
  evidence      jsonb,
  decline_reason text
);

CREATE TABLE document_events (
  id          bigserial PRIMARY KEY,
  document_id integer NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  signer_id   integer REFERENCES document_signers(id) ON DELETE CASCADE,
  event       text NOT NULL,                    -- created, sent, viewed, signed, declined, completed, cancelled
  details     jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
