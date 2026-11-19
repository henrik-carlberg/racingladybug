-- BankID via en OIDC-leverantör (t.ex. Criipto, Signicat): koppling till konto och pågående inloggningar/signeringar
ALTER TABLE users ADD COLUMN bankid_pnr_hash text UNIQUE;
ALTER TABLE users ADD COLUMN bankid_linked_at timestamptz;
CREATE TABLE bankid_flows (
  state_hash text PRIMARY KEY,
  nonce      text NOT NULL,
  verifier   text NOT NULL,
  purpose    text NOT NULL CHECK (purpose IN ('login','link','sign')),
  user_id    int REFERENCES users(id) ON DELETE CASCADE,
  signer_id  int REFERENCES document_signers(id) ON DELETE CASCADE,
  sign_token text,
  back       text NOT NULL DEFAULT '/',
  created_at timestamptz NOT NULL DEFAULT now()
);
