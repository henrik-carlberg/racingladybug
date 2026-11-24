-- Leverantörsabonnemang: SaaS och licenser med kostnad per månad, antal licenser, förnyelse och uppsägningstid
CREATE TABLE IF NOT EXISTS supplier_subscriptions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id integer REFERENCES suppliers(id) ON DELETE SET NULL,
  name text NOT NULL,
  account integer NOT NULL DEFAULT 5420,
  cost bigint NOT NULL CHECK (cost > 0), -- exkl. moms per period, öre
  period_months integer NOT NULL DEFAULT 1 CHECK (period_months IN (1, 3, 6, 12, 24, 36)),
  seats integer NOT NULL DEFAULT 1 CHECK (seats > 0),
  seats_used integer NOT NULL DEFAULT 1 CHECK (seats_used >= 0),
  owner text NOT NULL DEFAULT '',
  renewal_date date NOT NULL,
  notice_days integer NOT NULL DEFAULT 30 CHECK (notice_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_on date,
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS supplier_subscriptions_company ON supplier_subscriptions (company_id);
