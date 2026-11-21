-- Högkostnadsskydd för sjuklön: bokförd fordran på Försäkringskassan per år
CREATE TABLE IF NOT EXISTS sick_pay_claims (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  sick_cost bigint NOT NULL,
  total_cost bigint NOT NULL,
  amount bigint NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, year)
);
