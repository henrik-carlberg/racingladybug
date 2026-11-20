-- Offentliga bidrag till företag: periodisering mot kostnaderna i ett projekt, utbetalningar, återbetalningsrisk och rapport till bidragsgivaren
CREATE TABLE company_grants (
  id            serial PRIMARY KEY,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  grantor       text NOT NULL,
  reference     text NOT NULL DEFAULT '',
  project_id    integer NOT NULL REFERENCES projects(id),
  amount        bigint NOT NULL CHECK (amount > 0),              -- beviljat belopp (tak)
  coverage_pct  numeric(5,2) NOT NULL CHECK (coverage_pct > 0 AND coverage_pct <= 100),
  budget        bigint NOT NULL DEFAULT 0,                       -- stödberättigande kostnader enligt ansökan
  period_from   date NOT NULL,
  period_to     date NOT NULL CHECK (period_to >= period_from),
  conditions    text NOT NULL DEFAULT '',
  risk          text NOT NULL DEFAULT 'none' CHECK (risk IN ('none','possible','probable')),
  risk_note     text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','repayable','repaid')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id)
);
CREATE TABLE grant_events (
  id          serial PRIMARY KEY,
  grant_id    integer NOT NULL REFERENCES company_grants(id) ON DELETE CASCADE,
  date        date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('payment','recognition','provision','repayment')),
  amount      bigint NOT NULL,
  voucher_id  integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grant_events_grant ON grant_events (grant_id, date);
