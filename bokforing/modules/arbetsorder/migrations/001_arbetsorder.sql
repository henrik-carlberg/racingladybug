-- Arbetsordrar: jobb hos kund med tid och material som blir en faktura
CREATE TABLE wo_orders (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number           integer NOT NULL,
  customer_id      integer NOT NULL REFERENCES customers(id),
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  address          text NOT NULL DEFAULT '',
  scheduled_date   date,
  assignee_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  project_id       integer REFERENCES projects(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new','scheduled','in_progress','done','invoiced','cancelled')),
  report           text NOT NULL DEFAULT '',         -- vad som gjordes
  signed_by        text NOT NULL DEFAULT '',         -- kundens namn vid godkännande på plats
  signed_at        timestamptz,
  invoice_id       integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_by       integer REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  done_at          timestamptz,
  UNIQUE (company_id, number)
);
CREATE TABLE wo_items (
  id          serial PRIMARY KEY,
  order_id    integer NOT NULL REFERENCES wo_orders(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('labor','material','other')),
  description text NOT NULL,
  quantity    numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit        text NOT NULL DEFAULT 'st',
  unit_price  bigint NOT NULL CHECK (unit_price >= 0),  -- öre exkl. moms
  vat_rate    integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  date        date NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wo_orders_company ON wo_orders (company_id, status);
