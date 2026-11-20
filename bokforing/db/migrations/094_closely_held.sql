-- Fåmansföretag: sparad K10 per ägare och år, kapitalförsäkringar med premier och värden
CREATE TABLE k10_history (
  owner_id    integer NOT NULL REFERENCES company_owners(id) ON DELETE CASCADE,
  year        integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  rule        text NOT NULL,
  limit_amount bigint NOT NULL,
  dividends   bigint NOT NULL,
  saved_next  bigint NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  saved_by    integer REFERENCES users(id) ON DELETE SET NULL,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, year)
);
CREATE TABLE capital_insurances (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  insurer     text NOT NULL DEFAULT '',
  policy_no   text NOT NULL DEFAULT '',
  pledged     text NOT NULL DEFAULT '',          -- t.ex. pantsatt för pensionsutfästelse till ägaren
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE capital_insurance_events (
  id            serial PRIMARY KEY,
  insurance_id  integer NOT NULL REFERENCES capital_insurances(id) ON DELETE CASCADE,
  date          date NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('premium','value','writedown')),
  amount        bigint NOT NULL,
  voucher_id    integer REFERENCES vouchers(id) ON DELETE SET NULL
);
CREATE INDEX capital_insurance_events_ins ON capital_insurance_events (insurance_id, date);
