-- Anläggningsregister med avskrivning enligt plan

CREATE TABLE assets (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             text NOT NULL,
  category         text NOT NULL,
  asset_account    integer NOT NULL,
  acc_dep_account  integer NOT NULL,
  dep_account      integer NOT NULL,
  acquired_on      date NOT NULL,
  cost             bigint NOT NULL CHECK (cost > 0),        -- anskaffningsvärde exkl. moms, öre
  residual         bigint NOT NULL DEFAULT 0 CHECK (residual >= 0),
  life_months      integer NOT NULL CHECK (life_months BETWEEN 1 AND 1200),
  dep_start        date NOT NULL,                           -- första månaden som skrivs av
  cost_center_id   integer REFERENCES cost_centers(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
  disposed_on      date,
  disposal_voucher_id integer REFERENCES vouchers(id),
  source_voucher_id integer REFERENCES vouchers(id),        -- verifikationen där anskaffningen bokfördes
  notes            text NOT NULL DEFAULT '',
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_company ON assets (company_id, status);

CREATE TABLE asset_depreciations (
  asset_id   integer NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  period     text NOT NULL,                                  -- ÅÅÅÅ-MM
  amount     bigint NOT NULL,
  voucher_id integer NOT NULL REFERENCES vouchers(id),
  PRIMARY KEY (asset_id, period)
);
