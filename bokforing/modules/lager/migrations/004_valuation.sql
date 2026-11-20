-- Lagervärdering: FIFO eller vägt snitt, lägsta värdets princip med inkurans per artikel och bokförda inventeringsdifferenser
CREATE TABLE inv_settings (
  company_id    integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  cost_method   text NOT NULL DEFAULT 'avg' CHECK (cost_method IN ('avg','fifo')),
  sell_cost_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (sell_cost_pct >= 0 AND sell_cost_pct < 100)
);
ALTER TABLE inv_products ADD COLUMN obsolete_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (obsolete_pct >= 0 AND obsolete_pct <= 100);
ALTER TABLE inv_valuations ADD COLUMN rule text NOT NULL DEFAULT 'cost', ADD COLUMN method text NOT NULL DEFAULT 'avg';
ALTER TABLE inv_movements ADD COLUMN voucher_id integer REFERENCES vouchers(id) ON DELETE SET NULL;
