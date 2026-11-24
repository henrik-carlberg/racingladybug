-- Produktkalkyl: självkostnadskalkyl (påläggsmetoden) per artikel eller tjänst med täckningsbidrag och marginal mot priset
CREATE TABLE IF NOT EXISTS cost_calcs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  product_id integer, -- inv_products (lagermodulens tabell skapas efter kärnans migreringar)
  batch_qty numeric(14,3) NOT NULL DEFAULT 1 CHECK (batch_qty > 0),
  labour_minutes numeric(12,2) NOT NULL DEFAULT 0 CHECK (labour_minutes >= 0),
  labour_rate bigint NOT NULL DEFAULT 0 CHECK (labour_rate >= 0), -- öre per timme inkl. sociala avgifter
  mo_pct numeric(6,2) NOT NULL DEFAULT 0,  -- materialomkostnader
  to_pct numeric(6,2) NOT NULL DEFAULT 0,  -- tillverkningsomkostnader på lönen
  affo_pct numeric(6,2) NOT NULL DEFAULT 0, -- administrations- och försäljningsomkostnader
  price bigint NOT NULL DEFAULT 0, -- pris exkl. moms om ingen artikel är kopplad
  target_margin numeric(6,2) NOT NULL DEFAULT 20,
  saved_cost bigint NOT NULL DEFAULT 0, -- självkostnad när kalkylen sparades
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS cost_calc_lines (
  id serial PRIMARY KEY,
  calc_id integer NOT NULL REFERENCES cost_calcs(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  component_id integer, -- inv_products
  description text NOT NULL DEFAULT '',
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost bigint NOT NULL DEFAULT 0 CHECK (unit_cost >= 0) -- används när ingen artikel är kopplad
);
CREATE INDEX IF NOT EXISTS cost_calc_lines_calc ON cost_calc_lines (calc_id);
