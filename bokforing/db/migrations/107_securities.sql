-- Värdepapper och placeringar: innehav, transaktioner och värdering i bokslutet
CREATE TABLE IF NOT EXISTS securities (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  identifier text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('listed','unlisted','fund','crypto','bond')),
  holding text NOT NULL CHECK (holding IN ('fixed','current')),
  business_related boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS security_trades (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  security_id integer NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('buy','sell','dividend','interest')),
  date date NOT NULL,
  quantity numeric(24,8) NOT NULL DEFAULT 0,
  amount bigint NOT NULL,
  fee bigint NOT NULL DEFAULT 0,
  cost bigint,
  gain bigint,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_trades_sec ON security_trades (security_id, date);
CREATE TABLE IF NOT EXISTS security_valuations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  security_id integer NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
  date date NOT NULL,
  market bigint NOT NULL,
  writedown bigint NOT NULL,
  change bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (security_id, date)
);
