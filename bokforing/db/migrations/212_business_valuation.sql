-- Företagsvärdering och planerat ägarskifte (ett aktuellt underlag per bolag)
CREATE TABLE IF NOT EXISTS business_valuations (
  company_id      integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  ebit_multiple   numeric(6,2) NOT NULL DEFAULT 5 CHECK (ebit_multiple >= 0 AND ebit_multiple <= 50),
  required_return numeric(6,2) NOT NULL DEFAULT 15 CHECK (required_return > 0 AND required_return < 100),
  surplus_value   bigint NOT NULL DEFAULT 0,   -- övervärden i tillgångar (t.ex. fastighet) före skatt, öre
  transfer_kind   text NOT NULL DEFAULT 'sale' CHECK (transfer_kind IN ('sale', 'gift')),
  owner_id        integer REFERENCES company_owners(id) ON DELETE SET NULL,
  share_pct       numeric(7,3) NOT NULL DEFAULT 100 CHECK (share_pct > 0 AND share_pct <= 100),
  price           bigint NOT NULL DEFAULT 0 CHECK (price >= 0),
  recipient       text NOT NULL DEFAULT '',
  qualified       boolean NOT NULL DEFAULT true,
  checklist       jsonb NOT NULL DEFAULT '[]',
  updated_by      integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
