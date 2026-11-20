-- Ekonomiska föreningar (insatser, utträde, återbäring) och stiftelser (ändamål, bidrag, fullföljdskrav)
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_org_form_check;
ALTER TABLE companies ADD CONSTRAINT companies_org_form_check CHECK (org_form IN ('ideell','brf','ek','stiftelse'));
CREATE TABLE coop_settings (
  company_id  integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  insats      bigint NOT NULL DEFAULT 0 CHECK (insats >= 0),
  purpose     text NOT NULL DEFAULT ''
);
ALTER TABLE members ADD COLUMN notice_on date, ADD COLUMN payable_from date;
CREATE TABLE coop_insatser (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date        date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('paid','repaid')),
  amount      bigint NOT NULL CHECK (amount > 0),
  voucher_id  integer REFERENCES vouchers(id) ON DELETE SET NULL
);
CREATE INDEX coop_insatser_member ON coop_insatser (member_id);
CREATE TABLE coop_refunds (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id  integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  total           bigint NOT NULL CHECK (total > 0),
  decided_on      date NOT NULL,
  voucher_id      integer REFERENCES vouchers(id) ON DELETE SET NULL,
  paid_voucher_id integer REFERENCES vouchers(id) ON DELETE SET NULL,
  UNIQUE (company_id, fiscal_year_id)
);
CREATE TABLE coop_refund_lines (
  refund_id   integer NOT NULL REFERENCES coop_refunds(id) ON DELETE CASCADE,
  member_id   integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  base        bigint NOT NULL,
  amount      bigint NOT NULL,
  PRIMARY KEY (refund_id, member_id)
);
CREATE TABLE foundation_grants (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  recipient       text NOT NULL,
  purpose         text NOT NULL DEFAULT '',
  decided_on      date NOT NULL,
  amount          bigint NOT NULL CHECK (amount > 0),
  voucher_id      integer REFERENCES vouchers(id) ON DELETE SET NULL,
  paid_on         date,
  paid_voucher_id integer REFERENCES vouchers(id) ON DELETE SET NULL
);
CREATE INDEX foundation_grants_company ON foundation_grants (company_id, decided_on);
