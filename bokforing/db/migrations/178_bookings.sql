-- Tidsbokning: tjänster med längd och pris, publik bokningslänk, förskott som förutbetald intäkt, intäkt när tjänsten är utförd, avbokning och uteblivet besök
CREATE TABLE IF NOT EXISTS booking_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  open_from integer NOT NULL DEFAULT 540 CHECK (open_from BETWEEN 0 AND 1440), -- minuter efter midnatt
  open_to integer NOT NULL DEFAULT 1020 CHECK (open_to BETWEEN 0 AND 1440),
  weekdays text NOT NULL DEFAULT '1,2,3,4,5', -- 1 = måndag
  cancel_hours integer NOT NULL DEFAULT 24 CHECK (cancel_hours >= 0),
  no_show_pct integer NOT NULL DEFAULT 100 CHECK (no_show_pct BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  CHECK (open_to > open_from)
);
CREATE TABLE IF NOT EXISTS booking_services (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 5 AND 720),
  price bigint NOT NULL CHECK (price >= 0), -- inkl. moms
  vat_rate integer NOT NULL DEFAULT 25 CHECK (vat_rate IN (0,6,12,25)),
  prepay boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, name)
);
CREATE TABLE IF NOT EXISTS bookings (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  service_id integer NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_min integer NOT NULL,
  end_min integer NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL DEFAULT '',
  customer_phone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','prepaid','done','no_show','cancelled')),
  price bigint NOT NULL,
  vat_rate integer NOT NULL,
  prepaid boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('online','staff')),
  prepay_voucher_id integer REFERENCES vouchers(id),
  close_voucher_id integer REFERENCES vouchers(id),
  kept bigint, -- behållen avgift vid sen avbokning eller uteblivet besök
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS bookings_day ON bookings (company_id, date);
