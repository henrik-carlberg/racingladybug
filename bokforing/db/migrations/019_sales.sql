-- Dagskassa (Z-rapport) och e-handel (Shopify, WooCommerce)

CREATE TABLE cash_reports (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        date NOT NULL,
  register    text NOT NULL DEFAULT 'Kassa 1',
  z_number    text NOT NULL DEFAULT '',
  data        jsonb NOT NULL,
  voucher_id  integer REFERENCES vouchers(id),
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, register, z_number, date)
);

CREATE TABLE shop_connections (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform         text NOT NULL CHECK (platform IN ('shopify','woocommerce')),
  name             text NOT NULL,
  path_token       text NOT NULL UNIQUE,              -- del av webhook-adressen
  secret_enc       text NOT NULL,                     -- signeringshemligheten (krypterad)
  clearing_account integer NOT NULL DEFAULT 1580,     -- där betalningen hamnar tills betalväxeln betalar ut
  cost_center_id   integer REFERENCES cost_centers(id),
  active           boolean NOT NULL DEFAULT true,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop_orders (
  id            serial PRIMARY KEY,
  connection_id integer NOT NULL REFERENCES shop_connections(id) ON DELETE CASCADE,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  number        text NOT NULL DEFAULT '',
  order_date    date NOT NULL,
  currency      text NOT NULL,
  total         bigint NOT NULL,
  vat           bigint NOT NULL,
  status        text NOT NULL CHECK (status IN ('booked','skipped','error')),
  message       text NOT NULL DEFAULT '',
  voucher_id    integer REFERENCES vouchers(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_id)
);
