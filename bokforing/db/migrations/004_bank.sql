-- Bankkoppling (Open Banking / filimport) och bankavstämning

CREATE TABLE bank_connections (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider       text NOT NULL,                 -- 'enablebanking'
  aspsp_name     text NOT NULL,                 -- bankens namn
  aspsp_country  text NOT NULL,
  session_enc    text,                          -- krypterat sessions-id hos leverantören
  valid_until    timestamptz,                   -- samtycket gäller till (normalt 90–180 dagar)
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','expired','revoked','error')),
  last_error     text,
  created_by     integer NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Engångs-state för OAuth-liknande redirect till banken
CREATE TABLE bank_auth_states (
  state          text PRIMARY KEY,
  connection_id  integer NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  user_id        integer NOT NULL REFERENCES users(id),
  expires_at     timestamptz NOT NULL
);

CREATE TABLE bank_accounts (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  connection_id    integer REFERENCES bank_connections(id) ON DELETE SET NULL,
  provider_uid     text,                         -- kontots id hos leverantören
  name             text NOT NULL,
  iban             text NOT NULL DEFAULT '',
  currency         text NOT NULL DEFAULT 'SEK',
  ledger_account   integer NOT NULL DEFAULT 1930, -- bokföringskonto
  balance          bigint,                        -- öre, senast hämtat saldo
  balance_date     date,
  last_synced_at   timestamptz,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, connection_id, provider_uid)
);

CREATE TABLE bank_transactions (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id  integer NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  external_id      text NOT NULL,                -- unik per konto (bankens referens eller hash)
  booking_date     date NOT NULL,
  amount           bigint NOT NULL,              -- öre, positivt = insättning
  currency         text NOT NULL DEFAULT 'SEK',
  description      text NOT NULL DEFAULT '',
  reference        text NOT NULL DEFAULT '',     -- OCR/meddelande
  counterparty     text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  match_type       text,                         -- invoice | supplier_invoice | voucher | booked
  match_id         integer,
  voucher_id       integer REFERENCES vouchers(id),
  matched_by       integer REFERENCES users(id),
  matched_at       timestamptz,
  source           text NOT NULL,                -- enablebanking | camt053 | csv
  raw              jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, external_id)
);
CREATE INDEX bank_transactions_open ON bank_transactions(company_id, status, booking_date);
