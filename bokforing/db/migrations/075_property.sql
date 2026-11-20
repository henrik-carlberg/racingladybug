-- Fastighet och uthyrning: fastigheter, lokaler med frivillig skattskyldighet, hyresavtal med index och deposition
CREATE TABLE properties (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  designation  text NOT NULL DEFAULT '',   -- fastighetsbeteckning
  address      text NOT NULL DEFAULT '',
  acquired_on  date,
  cost         bigint,                     -- anskaffningsvärde inkl. mark
  land         bigint,                     -- markvärde (1130, skrivs inte av)
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE assets ADD COLUMN property_id integer REFERENCES properties(id) ON DELETE SET NULL;
CREATE TABLE premises (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id  integer NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'lokal' CHECK (kind IN ('lokal','bostad','garage','forrad')),
  area         numeric(10,1) NOT NULL DEFAULT 0 CHECK (area >= 0),
  vat_liable   boolean NOT NULL DEFAULT false,  -- frivillig skattskyldighet för uthyrning av verksamhetslokal
  vat_from     date
);
CREATE TABLE property_index (
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year         integer NOT NULL,
  value        numeric(10,2) NOT NULL CHECK (value > 0),  -- KPI oktober
  PRIMARY KEY (company_id, year)
);
CREATE TABLE leases (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  premise_id   integer NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
  customer_id  integer NOT NULL REFERENCES customers(id),
  start_date   date NOT NULL,
  end_date     date,
  base_rent    bigint NOT NULL CHECK (base_rent > 0),   -- årshyra exkl. moms
  index_year   integer,                                 -- basårets index (oktober)
  index_share  numeric(5,2) NOT NULL DEFAULT 100 CHECK (index_share BETWEEN 0 AND 100),
  billing      text NOT NULL DEFAULT 'quarter' CHECK (billing IN ('month','quarter')),
  deposit      bigint NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  deposit_voucher_id integer REFERENCES vouchers(id) ON DELETE SET NULL,
  deposit_returned_voucher_id integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leases_company ON leases (company_id);
CREATE TABLE lease_invoices (
  lease_id     integer NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  period       text NOT NULL,
  rent         bigint NOT NULL,
  invoice_id   integer REFERENCES invoices(id) ON DELETE SET NULL,
  PRIMARY KEY (lease_id, period)
);
