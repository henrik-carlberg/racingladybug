-- Kortterminaler och betalleverantörer: dagsrapporter och utbetalningar bokförs och stäms av mot banken
CREATE TABLE payment_providers (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('zettle','sumup','stripe','klarna','shopify')),
  name             text NOT NULL,
  credentials_enc  text NOT NULL,
  clearing_account integer NOT NULL DEFAULT 1580,
  fee_account      integer NOT NULL DEFAULT 6570,
  default_vat      integer NOT NULL DEFAULT 25 CHECK (default_vat IN (25, 12, 6, 0)),
  bank_account_id  integer REFERENCES bank_accounts(id) ON DELETE SET NULL,
  active           boolean NOT NULL DEFAULT true,
  synced_until     date,
  last_sync_at     timestamptz,
  last_error       text NOT NULL DEFAULT '',
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provider_reports (
  id                  serial PRIMARY KEY,
  provider_id         integer NOT NULL REFERENCES payment_providers(id) ON DELETE CASCADE,
  company_id          integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('sales','payout')),
  external_id         text NOT NULL,
  date                date NOT NULL,
  gross               bigint NOT NULL DEFAULT 0,
  fees                bigint NOT NULL DEFAULT 0,
  refunds             bigint NOT NULL DEFAULT 0,
  net                 bigint NOT NULL DEFAULT 0,
  data                jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL CHECK (status IN ('booked','matched','error','skipped')),
  message             text NOT NULL DEFAULT '',
  voucher_id          integer REFERENCES vouchers(id) ON DELETE SET NULL,
  bank_transaction_id integer REFERENCES bank_transactions(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, kind, external_id)
);
CREATE INDEX provider_reports_company ON provider_reports (company_id, date DESC);
