-- Evenemang och biljettförsäljning: biljettyper med momssats och kapacitet, biljettintäkter och sponsring som förutbetald intäkt till eventdagen, återbetalning, kostnader och resultat per event
CREATE TABLE IF NOT EXISTS company_events (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  date date NOT NULL,
  venue text NOT NULL DEFAULT '',
  budget_cost bigint NOT NULL DEFAULT 0 CHECK (budget_cost >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','held','cancelled')),
  recognized_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS event_ticket_types (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES company_events(id) ON DELETE CASCADE,
  name text NOT NULL,
  price bigint NOT NULL CHECK (price > 0), -- inkl. moms
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0,6,12,25)),
  capacity integer CHECK (capacity > 0),
  UNIQUE (event_id, name)
);
CREATE TABLE IF NOT EXISTS event_tickets (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES company_events(id) ON DELETE CASCADE,
  type_id integer NOT NULL REFERENCES event_ticket_types(id) ON DELETE CASCADE,
  buyer text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  amount bigint NOT NULL, -- inkl. moms
  status text NOT NULL DEFAULT 'sold' CHECK (status IN ('sold','refunded')),
  sold_on date NOT NULL,
  voucher_id integer REFERENCES vouchers(id),
  refund_voucher_id integer REFERENCES vouchers(id)
);
CREATE TABLE IF NOT EXISTS event_sponsors (
  id serial PRIMARY KEY,
  event_id integer NOT NULL REFERENCES company_events(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0), -- exkl. moms
  invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS event_costs (
  event_id integer NOT NULL REFERENCES company_events(id) ON DELETE CASCADE,
  supplier_invoice_id integer NOT NULL UNIQUE REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, supplier_invoice_id)
);
