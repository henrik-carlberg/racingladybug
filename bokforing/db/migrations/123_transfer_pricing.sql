-- Internprissättning: koncerninterna transaktioner med prismetod och dokumentation
CREATE TABLE IF NOT EXISTS tp_transactions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  counterparty text NOT NULL,
  country text NOT NULL DEFAULT 'SE',
  type text NOT NULL CHECK (type IN ('goods','services','loan','license','other')),
  description text NOT NULL DEFAULT '',
  amount bigint NOT NULL CHECK (amount >= 0),
  method text NOT NULL CHECK (method IN ('cup','cost_plus','resale_minus','tnmm','profit_split')),
  markup_pct numeric(6,2),
  rate_pct numeric(6,3),
  range_min numeric(6,3),
  range_max numeric(6,3),
  low_value boolean NOT NULL DEFAULT false,
  documented boolean NOT NULL DEFAULT false,
  documentation text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
