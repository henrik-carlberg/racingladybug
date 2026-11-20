-- Tillverkning: stycklistor och tillverkningsorder
CREATE TABLE IF NOT EXISTS inv_boms (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES inv_products(id) ON DELETE CASCADE,
  labor_minutes numeric(10,2) NOT NULL DEFAULT 0 CHECK (labor_minutes >= 0),
  labor_rate bigint NOT NULL DEFAULT 0 CHECK (labor_rate >= 0),
  overhead_pct numeric(6,2) NOT NULL DEFAULT 0 CHECK (overhead_pct >= 0 AND overhead_pct <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, product_id)
);
CREATE TABLE IF NOT EXISTS inv_bom_lines (
  bom_id integer NOT NULL REFERENCES inv_boms(id) ON DELETE CASCADE,
  component_id integer NOT NULL REFERENCES inv_products(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (bom_id, component_id)
);
CREATE TABLE IF NOT EXISTS inv_production_orders (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number integer NOT NULL,
  bom_id integer NOT NULL REFERENCES inv_boms(id),
  product_id integer NOT NULL REFERENCES inv_products(id),
  warehouse_id integer NOT NULL REFERENCES inv_warehouses(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','started','done','cancelled')),
  planned jsonb NOT NULL,
  material bigint NOT NULL DEFAULT 0,
  labor bigint NOT NULL DEFAULT 0,
  overhead bigint NOT NULL DEFAULT 0,
  actual_minutes numeric(12,2),
  started_on date,
  done_on date,
  start_voucher_id integer REFERENCES vouchers(id),
  done_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
