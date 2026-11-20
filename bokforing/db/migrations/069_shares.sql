-- Aktiebok med aktienummer, överlåtelser, nyemission och historik
CREATE TABLE share_settings (
  company_id     integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  share_capital  bigint NOT NULL CHECK (share_capital > 0),
  total_shares   integer NOT NULL CHECK (total_shares > 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE share_holdings (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holder_name  text NOT NULL,
  holder_id    text NOT NULL DEFAULT '',     -- person- eller organisationsnummer
  address      text NOT NULL DEFAULT '',
  share_class  text NOT NULL DEFAULT 'B' CHECK (share_class IN ('A','B')),
  from_no      integer NOT NULL CHECK (from_no > 0),
  to_no        integer NOT NULL,
  acquired_on  date NOT NULL,
  CHECK (to_no >= from_no)
);
CREATE INDEX share_holdings_company ON share_holdings (company_id, from_no);
CREATE TABLE share_events (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('founding','transfer','issue')),
  date        date NOT NULL,
  text        text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}',
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE share_issues (
  id                       serial PRIMARY KEY,
  company_id               integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  decided_on               date NOT NULL,
  new_shares               integer NOT NULL CHECK (new_shares > 0),
  price                    bigint NOT NULL CHECK (price > 0),      -- teckningskurs per aktie, öre
  share_class              text NOT NULL DEFAULT 'B' CHECK (share_class IN ('A','B')),
  status                   text NOT NULL DEFAULT 'decided' CHECK (status IN ('decided','paid','registered','cancelled')),
  document_id              integer REFERENCES documents(id) ON DELETE SET NULL,
  payment_voucher_id       integer REFERENCES vouchers(id) ON DELETE SET NULL,
  registration_voucher_id  integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_by               integer REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE share_subscriptions (
  id          serial PRIMARY KEY,
  issue_id    integer NOT NULL REFERENCES share_issues(id) ON DELETE CASCADE,
  name        text NOT NULL,
  holder_id   text NOT NULL DEFAULT '',
  address     text NOT NULL DEFAULT '',
  shares      integer NOT NULL CHECK (shares > 0)
);
