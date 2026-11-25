-- Kund- och produktlönsamhet: antaganden för timkostnad och räntekostnad på sena betalningar
CREATE TABLE IF NOT EXISTS profitability_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  hour_cost bigint NOT NULL DEFAULT 50000 CHECK (hour_cost >= 0), -- öre per timme inkl. sociala avgifter
  interest_pct numeric(6,2) NOT NULL DEFAULT 8 CHECK (interest_pct >= 0 AND interest_pct < 100)
);
