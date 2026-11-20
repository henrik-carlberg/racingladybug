-- Bokslutspärm: specifikation och avstämning per balanskonto och räkenskapsår
CREATE TABLE closing_binder_items (
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  account        integer NOT NULL CHECK (account BETWEEN 1000 AND 2999),
  amount         bigint,                 -- manuellt specificerat belopp (tomt = automatisk specifikation)
  note           text NOT NULL DEFAULT '',
  reference      text NOT NULL DEFAULT '',
  done           boolean NOT NULL DEFAULT false,
  signed_by      integer REFERENCES users(id) ON DELETE SET NULL,
  signed_at      timestamptz,
  PRIMARY KEY (company_id, fiscal_year_id, account)
);
