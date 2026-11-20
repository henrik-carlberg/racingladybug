-- Kostnadsfördelning (fördelningsnycklar) och interna debiteringar mellan kostnadsställen
CREATE TABLE allocation_keys (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  basis          text NOT NULL DEFAULT '',                 -- t.ex. kvm, antal anställda
  account_from   integer NOT NULL CHECK (account_from BETWEEN 4000 AND 8999),
  account_to     integer NOT NULL CHECK (account_to BETWEEN 4000 AND 8999),
  source_cost_center_id integer REFERENCES cost_centers(id) ON DELETE SET NULL, -- NULL = kostnader utan kostnadsställe
  active         boolean NOT NULL DEFAULT true,
  CHECK (account_to >= account_from)
);
CREATE TABLE allocation_weights (
  key_id         integer NOT NULL REFERENCES allocation_keys(id) ON DELETE CASCADE,
  cost_center_id integer NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  weight         numeric(14,3) NOT NULL CHECK (weight > 0),
  PRIMARY KEY (key_id, cost_center_id)
);
CREATE TABLE allocation_runs (
  key_id         integer NOT NULL REFERENCES allocation_keys(id) ON DELETE CASCADE,
  period         text NOT NULL,
  voucher_id     integer REFERENCES vouchers(id) ON DELETE SET NULL,
  amount         bigint NOT NULL,
  PRIMARY KEY (key_id, period)
);
CREATE TABLE internal_charges (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_cost_center_id integer NOT NULL REFERENCES cost_centers(id),
  to_cost_center_id   integer NOT NULL REFERENCES cost_centers(id),
  description    text NOT NULL,
  amount         bigint NOT NULL CHECK (amount > 0),
  recurring      boolean NOT NULL DEFAULT false,            -- varje månad
  start_period   text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  CHECK (from_cost_center_id <> to_cost_center_id)
);
CREATE TABLE internal_charge_runs (
  charge_id      integer NOT NULL REFERENCES internal_charges(id) ON DELETE CASCADE,
  period         text NOT NULL,
  voucher_id     integer REFERENCES vouchers(id) ON DELETE SET NULL,
  PRIMARY KEY (charge_id, period)
);
