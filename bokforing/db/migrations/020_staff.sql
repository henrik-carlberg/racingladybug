-- Schema (arbetspass) och personalliggare

CREATE TABLE work_sites (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  address      text NOT NULL DEFAULT '',
  kiosk_token  text NOT NULL UNIQUE,         -- adress till stämplingssidan på arbetsplatsen
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shifts (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  site_id      integer REFERENCES work_sites(id) ON DELETE SET NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  role         text NOT NULL DEFAULT '',
  note         text NOT NULL DEFAULT '',
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX shifts_company_time ON shifts (company_id, starts_at);

-- Personalliggaren: vem som är verksam, när arbetspasset börjar och slutar (skatteförfarandelagen 39 kap.)
CREATE TABLE staff_log (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  site_id         integer NOT NULL REFERENCES work_sites(id),
  employee_id     integer REFERENCES employees(id) ON DELETE SET NULL,
  person_name     text NOT NULL,
  personal_number text NOT NULL,
  check_in        timestamptz NOT NULL,
  check_out       timestamptz,
  source          text NOT NULL CHECK (source IN ('self','kiosk','manager')),
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out IS NULL OR check_out >= check_in)
);
CREATE INDEX staff_log_site_time ON staff_log (company_id, site_id, check_in);

-- Rättelser sparas med ursprungligt värde, nytt värde, orsak och vem som rättade
CREATE TABLE staff_log_changes (
  id          serial PRIMARY KEY,
  log_id      integer NOT NULL REFERENCES staff_log(id) ON DELETE CASCADE,
  field       text NOT NULL,
  old_value   text NOT NULL DEFAULT '',
  new_value   text NOT NULL DEFAULT '',
  reason      text NOT NULL,
  changed_by  integer REFERENCES users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
