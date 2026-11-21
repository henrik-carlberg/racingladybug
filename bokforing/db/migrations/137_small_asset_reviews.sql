-- Bedömning av kostnadsförda inventarier (direktavdrag eller aktivering)
CREATE TABLE IF NOT EXISTS small_asset_reviews (
  voucher_id integer PRIMARY KEY REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('short_life','keep','activated')),
  note text NOT NULL DEFAULT '',
  asset_id integer REFERENCES assets(id) ON DELETE SET NULL,
  voucher_out integer REFERENCES vouchers(id),
  decided_by integer REFERENCES users(id),
  decided_at timestamptz NOT NULL DEFAULT now()
);
