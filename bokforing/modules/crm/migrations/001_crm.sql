-- CRM-modulen: kontaktpersoner och aktiviteter (tidslinje) per kund
CREATE TABLE crm_contacts (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text NOT NULL DEFAULT '',
  phone       text NOT NULL DEFAULT '',
  title       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_contacts_customer ON crm_contacts(customer_id);

CREATE TABLE crm_activities (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id  integer REFERENCES customers(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('note','call','meeting','email','task','system')),
  subject      text NOT NULL,
  body         text NOT NULL DEFAULT '',
  due_date     date,
  done         boolean NOT NULL DEFAULT false,
  source_event text,                       -- händelse-id om aktiviteten skapades automatiskt
  created_by   integer REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_activities_customer ON crm_activities(customer_id, created_at DESC);
