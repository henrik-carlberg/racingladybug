-- Ombildning från enskild firma till aktiebolag (underprisöverlåtelse)
CREATE TABLE IF NOT EXISTS conversions (
  ef_company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  ab_company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  net bigint NOT NULL,
  payment text NOT NULL CHECK (payment IN ('debt','contribution')),
  pfond_reversed bigint NOT NULL DEFAULT 0,
  expansion_reversed bigint NOT NULL DEFAULT 0,
  ef_voucher_id integer REFERENCES vouchers(id),
  ab_voucher_id integer REFERENCES vouchers(id),
  fund_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
