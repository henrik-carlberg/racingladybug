-- Inköp, lager och logistik: artiklar, lagerställen, saldon, lagerrörelser, inköpsorder och kundorder.
CREATE TABLE inv_warehouses (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  address     text NOT NULL DEFAULT '',
  UNIQUE (company_id, name)
);

CREATE TABLE inv_products (
  id             serial PRIMARY KEY,
  company_id     integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku            text NOT NULL,
  name           text NOT NULL,
  unit           text NOT NULL DEFAULT 'st',
  purchase_price bigint NOT NULL DEFAULT 0,          -- senaste inköpspris, öre per enhet
  avg_cost       numeric(16,2) NOT NULL DEFAULT 0,   -- vägt genomsnittligt anskaffningsvärde, öre per enhet
  sales_price    bigint NOT NULL DEFAULT 0,          -- öre per enhet exkl. moms
  vat_rate       integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  reorder_point  numeric(14,3) NOT NULL DEFAULT 0,   -- beställ när tillgängligt understiger
  reorder_qty    numeric(14,3) NOT NULL DEFAULT 0,   -- föreslagen beställning
  supplier_id    integer REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_sku   text NOT NULL DEFAULT '',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);

CREATE TABLE inv_stock (
  product_id   integer NOT NULL REFERENCES inv_products(id) ON DELETE CASCADE,
  warehouse_id integer NOT NULL REFERENCES inv_warehouses(id) ON DELETE CASCADE,
  qty          numeric(14,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE inv_movements (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id   integer NOT NULL REFERENCES inv_products(id) ON DELETE CASCADE,
  warehouse_id integer NOT NULL REFERENCES inv_warehouses(id),
  date         date NOT NULL,
  qty          numeric(14,3) NOT NULL,              -- positivt = in, negativt = ut
  unit_cost    numeric(16,2) NOT NULL DEFAULT 0,    -- öre
  type         text NOT NULL CHECK (type IN ('opening', 'receipt', 'delivery', 'adjustment', 'transfer')),
  ref_type     text,                                -- purchase_order, sales_order, count
  ref_id       integer,
  note         text NOT NULL DEFAULT '',
  created_by   integer NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inv_movements_product ON inv_movements(product_id, date);

CREATE TABLE inv_purchase_orders (
  id                  serial PRIMARY KEY,
  company_id          integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number              integer NOT NULL,
  supplier_id         integer NOT NULL REFERENCES suppliers(id),
  warehouse_id        integer NOT NULL REFERENCES inv_warehouses(id),
  order_date          date NOT NULL,
  expected_date       date,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled')),
  notes               text NOT NULL DEFAULT '',
  supplier_invoice_id integer REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  created_by          integer NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE TABLE inv_purchase_order_lines (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL REFERENCES inv_purchase_orders(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES inv_products(id),
  qty        numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price bigint NOT NULL DEFAULT 0,  -- öre exkl. moms
  received   numeric(14,3) NOT NULL DEFAULT 0
);

CREATE TABLE inv_sales_orders (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number           integer NOT NULL,
  customer_id      integer NOT NULL REFERENCES customers(id),
  warehouse_id     integer NOT NULL REFERENCES inv_warehouses(id),
  order_date       date NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'shipped', 'invoiced', 'cancelled')),
  delivery_address text NOT NULL DEFAULT '',
  your_reference   text NOT NULL DEFAULT '',
  carrier          text NOT NULL DEFAULT '',
  tracking         text NOT NULL DEFAULT '',
  shipped_date     date,
  invoice_id       integer REFERENCES invoices(id) ON DELETE SET NULL,
  notes            text NOT NULL DEFAULT '',
  created_by       integer NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE TABLE inv_sales_order_lines (
  id         serial PRIMARY KEY,
  order_id   integer NOT NULL REFERENCES inv_sales_orders(id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES inv_products(id),
  qty        numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price bigint NOT NULL DEFAULT 0
);

-- Bokförda lagervärderingar (lagerförändring i bokslutet)
CREATE TABLE inv_valuations (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        date NOT NULL,
  cost_value  bigint NOT NULL,     -- anskaffningsvärde enligt lagret
  book_value  bigint NOT NULL,     -- bokfört värde (efter ev. 97 %-regeln)
  voucher_id  integer REFERENCES vouchers(id),
  created_by  integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
