-- Skifte vid likvidation: bokföring och skifteslikvid per ägare
ALTER TABLE liquidations ADD COLUMN IF NOT EXISTS distribution_voucher_id integer REFERENCES vouchers(id);
CREATE TABLE IF NOT EXISTS liquidation_payouts (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  owner_id integer REFERENCES company_owners(id) ON DELETE SET NULL,
  name text NOT NULL,
  amount bigint NOT NULL,
  cost_basis bigint NOT NULL DEFAULT 0,
  gain bigint NOT NULL
);
