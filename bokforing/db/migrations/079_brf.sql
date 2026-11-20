-- Bostadsrättsföreningar: lägenhetsförteckning, avgifter per andelstal, överlåtelser, pantsättningar och underhållsplan
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_org_form_check;
ALTER TABLE companies ADD CONSTRAINT companies_org_form_check CHECK (org_form IN ('ideell','brf'));
CREATE TABLE brf_apartments (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,                 -- föreningens lägenhetsbeteckning
  skv_number   text NOT NULL DEFAULT '',      -- Skatteverkets lägenhetsnummer (t.ex. 1101)
  floor        text NOT NULL DEFAULT '',
  rooms        text NOT NULL DEFAULT '',
  area         numeric(8,1) NOT NULL CHECK (area > 0),
  purpose      text NOT NULL DEFAULT 'Bostad',
  share        numeric(12,6) NOT NULL CHECK (share > 0),   -- andelstal
  insats       bigint NOT NULL DEFAULT 0,
  upplatelse   bigint NOT NULL DEFAULT 0,
  granted_on   date,                          -- dag för upplåtelse
  UNIQUE (company_id, number)
);
CREATE TABLE brf_owners (
  id           serial PRIMARY KEY,
  apartment_id integer NOT NULL REFERENCES brf_apartments(id) ON DELETE CASCADE,
  customer_id  integer NOT NULL REFERENCES customers(id),
  name         text NOT NULL,
  share_pct    numeric(5,2) NOT NULL DEFAULT 100 CHECK (share_pct > 0 AND share_pct <= 100),
  from_date    date NOT NULL,
  to_date      date
);
CREATE INDEX brf_owners_apartment ON brf_owners (apartment_id);
CREATE TABLE brf_transfers (
  id           serial PRIMARY KEY,
  apartment_id integer NOT NULL REFERENCES brf_apartments(id) ON DELETE CASCADE,
  date         date NOT NULL,
  seller       text NOT NULL,
  buyer        text NOT NULL,
  price        bigint,
  fee_invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE brf_pledges (
  id           serial PRIMARY KEY,
  apartment_id integer NOT NULL REFERENCES brf_apartments(id) ON DELETE CASCADE,
  lender       text NOT NULL,
  amount       bigint,
  date         date NOT NULL,
  released_on  date,
  fee_invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL
);
CREATE TABLE brf_budgets (
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year         integer NOT NULL,
  fee_budget   bigint NOT NULL CHECK (fee_budget > 0),   -- årsavgifter totalt
  periods      integer NOT NULL DEFAULT 12 CHECK (periods IN (4, 12)),
  PRIMARY KEY (company_id, year)
);
CREATE TABLE brf_fee_invoices (
  apartment_id integer NOT NULL REFERENCES brf_apartments(id) ON DELETE CASCADE,
  period       text NOT NULL,
  invoice_id   integer REFERENCES invoices(id) ON DELETE SET NULL,
  PRIMARY KEY (apartment_id, period)
);
CREATE TABLE brf_maintenance (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year         integer NOT NULL,
  item         text NOT NULL,
  amount       bigint NOT NULL CHECK (amount > 0),
  done         boolean NOT NULL DEFAULT false
);
CREATE INDEX brf_maintenance_company ON brf_maintenance (company_id, year);
