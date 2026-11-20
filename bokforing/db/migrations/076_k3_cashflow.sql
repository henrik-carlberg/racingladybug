-- K3: redovisningsregelverk per bolag och temporära skillnader för uppskjuten skatt
ALTER TABLE companies ADD COLUMN accounting_framework text NOT NULL DEFAULT 'K2' CHECK (accounting_framework IN ('K2','K3'));
ALTER TABLE companies ADD COLUMN k3_from date;
CREATE TABLE k3_temp_diffs (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  label          text NOT NULL,
  amount         bigint NOT NULL,          -- bokfört minus skattemässigt värde (öre)
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX k3_temp_diffs_fy ON k3_temp_diffs (fiscal_year_id);
