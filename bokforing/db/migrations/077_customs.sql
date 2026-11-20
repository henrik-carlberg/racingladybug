-- Import och tull: Tullverkets beslut, fördelning på inköpsorder och avstämning mot Tullverkets besked
CREATE TABLE customs_decisions (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  decision_no    text NOT NULL,                  -- Tullverkets id / beslutsnummer
  date           date NOT NULL,
  description    text NOT NULL DEFAULT '',
  supplier_id    integer REFERENCES suppliers(id) ON DELETE SET NULL,
  customs_value  bigint NOT NULL CHECK (customs_value >= 0),
  duty           bigint NOT NULL DEFAULT 0 CHECK (duty >= 0),
  fees           bigint NOT NULL DEFAULT 0 CHECK (fees >= 0),
  freight_sweden bigint NOT NULL DEFAULT 0 CHECK (freight_sweden >= 0),
  vat_rate       integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (25, 12, 6)),
  vat_base       bigint NOT NULL,
  vat            bigint NOT NULL,
  vat_stated     bigint,                          -- moms enligt beslutet, om angiven
  freight_alloc  bigint NOT NULL DEFAULT 0,       -- frakt till lagret som fördelas på varorna (utöver tull)
  po_id          integer,                         -- inköpsorder i lagermodulen (inv_purchase_orders)
  allocated_at   timestamptz,
  voucher_id     integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, decision_no)
);
CREATE TABLE customs_allocations (
  decision_id    integer NOT NULL REFERENCES customs_decisions(id) ON DELETE CASCADE,
  product_id     integer NOT NULL,               -- inv_products (lagermodulen)
  qty            numeric(14,3) NOT NULL,
  allocated      bigint NOT NULL,
  to_inventory   bigint NOT NULL,
  unit_before    numeric(16,2) NOT NULL,
  unit_after     numeric(16,2) NOT NULL,
  PRIMARY KEY (decision_id, product_id)
);
CREATE TABLE customs_statements (
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month          text NOT NULL,                   -- ÅÅÅÅ-MM
  amount         bigint NOT NULL,                 -- att betala enligt Tullverkets besked (tull och avgifter)
  PRIMARY KEY (company_id, month)
);
