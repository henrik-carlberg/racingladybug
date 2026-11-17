-- Resursbokning: lokaler, utrustning, fordon och personer som kan bokas, med krockkontroll, godkännande och fakturering.
CREATE TABLE res_resources (
  id                serial PRIMARY KEY,
  company_id        integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              text NOT NULL,
  kind              text NOT NULL DEFAULT 'room' CHECK (kind IN ('room', 'equipment', 'vehicle', 'person', 'other')),
  description       text NOT NULL DEFAULT '',
  location          text NOT NULL DEFAULT '',
  capacity          integer,
  price_hour        bigint NOT NULL DEFAULT 0,   -- öre exkl. moms
  price_day         bigint NOT NULL DEFAULT 0,   -- öre exkl. moms (tak per påbörjad dag)
  vat_rate          integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  open_from         time NOT NULL DEFAULT '07:00',
  open_to           time NOT NULL DEFAULT '18:00',
  requires_approval boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE res_bookings (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  resource_id integer NOT NULL REFERENCES res_resources(id) ON DELETE CASCADE,
  title       text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  booked_by   integer NOT NULL REFERENCES users(id),
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  project_id  integer REFERENCES projects(id) ON DELETE SET NULL,
  billable    boolean NOT NULL DEFAULT false,
  invoice_id  integer REFERENCES invoices(id) ON DELETE SET NULL,
  series_id   text,                               -- återkommande bokningar
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX res_bookings_resource ON res_bookings(resource_id, starts_at);
CREATE INDEX res_bookings_company ON res_bookings(company_id, starts_at);
