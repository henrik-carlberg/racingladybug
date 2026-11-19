-- Skatteplanering: debiterad preliminärskatt och bokförda bokslutsdispositioner
CREATE TABLE tax_settings (
  company_id      integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  prelim_monthly  bigint NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tax_appropriations (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id   integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('koncernbidrag','overavskrivning','periodiseringsfond','aterforing')),
  amount           bigint NOT NULL,
  voucher_id       integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fiscal_year_id, kind)
);
