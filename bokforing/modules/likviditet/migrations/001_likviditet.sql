-- Budget per kategori och månad samt likviditetsprognos med planerade poster.
CREATE TABLE liq_budget (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year       integer NOT NULL,
  month      integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  category   text NOT NULL,
  amount     bigint NOT NULL DEFAULT 0,      -- öre, intäkter och kostnader som positiva belopp
  PRIMARY KEY (company_id, year, month, category)
);

CREATE TABLE liq_items (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        date NOT NULL,
  amount      bigint NOT NULL,                -- öre, positivt = inbetalning, negativt = utbetalning
  description text NOT NULL,
  recurrence  text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'monthly', 'quarterly', 'yearly')),
  until       date,
  created_by  integer REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE liq_settings (
  company_id        integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  prelskatt_monthly bigint NOT NULL DEFAULT 0, -- debiterad preliminärskatt per månad, öre
  payment_delay     integer NOT NULL DEFAULT 0, -- kunders genomsnittliga försening i dagar
  min_balance       bigint NOT NULL DEFAULT 0   -- varna under denna kassanivå
);
