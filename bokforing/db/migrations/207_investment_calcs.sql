-- Investeringskalkyl: nuvärde, internränta, återbetalningstid och annuitet med känslighetsanalys och jämförelse av köp, lån och leasing
CREATE TABLE IF NOT EXISTS investment_calcs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'maskiner',
  investment bigint NOT NULL CHECK (investment > 0),
  life_years integer NOT NULL CHECK (life_years BETWEEN 1 AND 50),
  annual_in bigint NOT NULL DEFAULT 0 CHECK (annual_in >= 0),
  annual_out bigint NOT NULL DEFAULT 0 CHECK (annual_out >= 0),
  growth_pct numeric(6,2) NOT NULL DEFAULT 0,
  residual bigint NOT NULL DEFAULT 0 CHECK (residual >= 0),
  rate_pct numeric(6,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct < 100),
  loan_rate_pct numeric(6,2),
  lease_monthly bigint,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  asset_id integer REFERENCES assets(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id)
);
