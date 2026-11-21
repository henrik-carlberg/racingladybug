-- Valutaterminer
CREATE TABLE IF NOT EXISTS fx_forwards (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  direction text NOT NULL CHECK (direction IN ('sell','buy')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  forward_rate numeric(12,6) NOT NULL CHECK (forward_rate > 0),
  trade_date date NOT NULL,
  maturity date NOT NULL,
  hedged text NOT NULL DEFAULT '',
  reserved bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  spot_rate numeric(12,6),
  result bigint,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
