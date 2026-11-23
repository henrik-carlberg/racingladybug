-- Indexuppräkning av återkommande avtal: indexserier per månad, avtal kopplade till index med basmånad och andel, förhandsgranskning, prishistorik
CREATE TABLE IF NOT EXISTS index_values (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  index_name text NOT NULL,
  period text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  value numeric(10,2) NOT NULL CHECK (value > 0),
  PRIMARY KEY (company_id, index_name, period)
);
CREATE TABLE IF NOT EXISTS contract_indexation (
  contract_id integer PRIMARY KEY, -- avt_contracts (avtalsmodulens tabell skapas efter kärnans migreringar)
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  index_name text NOT NULL,
  base_period text NOT NULL CHECK (base_period ~ '^\d{4}-\d{2}$'),
  share numeric(5,2) NOT NULL DEFAULT 100 CHECK (share > 0 AND share <= 100),
  floor boolean NOT NULL DEFAULT true, -- priset sänks aldrig under baspriset
  base_prices jsonb NOT NULL, -- {radid: öre} vid koppling
  last_period text,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS contract_price_history (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id integer NOT NULL,
  line_id integer NOT NULL,
  date date NOT NULL,
  old_price bigint NOT NULL,
  new_price bigint NOT NULL,
  index_period text NOT NULL,
  factor numeric(10,6) NOT NULL,
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS contract_price_history_contract ON contract_price_history (company_id, contract_id, date);
