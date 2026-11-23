-- Scenarioplanering: tänk om-scenarier ovanpå budgeten (eller årstakten) med jämförelse av resultat och kassa per månad
CREATE TABLE IF NOT EXISTS scenarios (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  created_by integer REFERENCES users(id),
  UNIQUE (company_id, name, year)
);
CREATE TABLE IF NOT EXISTS scenario_items (
  id serial PRIMARY KEY,
  scenario_id integer NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('price_pct','cost_pct','lost_customer','hire','investment','loan')),
  label text NOT NULL,
  from_month integer NOT NULL CHECK (from_month BETWEEN 1 AND 12),
  amount bigint NOT NULL DEFAULT 0, -- öre: månadslön, investering, lånebelopp, förlorad omsättning per månad
  pct numeric(7,3) NOT NULL DEFAULT 0, -- prisändring, kostnadsändring, ränta
  years integer NOT NULL DEFAULT 0 -- avskrivnings- eller amorteringstid
);
