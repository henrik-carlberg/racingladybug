-- Kundreskontra: betalningspåminnelser, påminnelseavgift, dröjsmålsränta och underlag för inkasso.
CREATE TABLE rk_settings (
  company_id       integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  first_days       integer NOT NULL DEFAULT 7,     -- dagar efter förfallodag för påminnelse 1
  second_days      integer NOT NULL DEFAULT 21,    -- påminnelse 2
  collection_days  integer NOT NULL DEFAULT 35,    -- föreslå inkasso
  fee              bigint NOT NULL DEFAULT 6000,   -- påminnelseavgift, öre (högst 60 kr enligt lag 1981:739)
  reference_rate   numeric(5,2),                   -- Riksbankens referensränta, procent
  interest_extra   numeric(5,2) NOT NULL DEFAULT 8,-- räntelagen 6 §: referensränta + 8 procentenheter
  fee_account      integer NOT NULL DEFAULT 3990,
  interest_account integer NOT NULL DEFAULT 8313,
  auto_remind      boolean NOT NULL DEFAULT false, -- skapa och skicka påminnelser automatiskt varje natt
  message          text NOT NULL DEFAULT ''
);

CREATE TABLE rk_reminders (
  id                serial PRIMARY KEY,
  company_id        integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id        integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  level             integer NOT NULL CHECK (level IN (1, 2)),
  date              date NOT NULL,
  fee               bigint NOT NULL DEFAULT 0,
  interest          bigint NOT NULL DEFAULT 0,
  emailed_to        text,
  charge_invoice_id integer REFERENCES invoices(id) ON DELETE SET NULL,
  created_by        integer REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, level)
);

CREATE TABLE rk_collections (
  invoice_id integer PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date       date NOT NULL,
  note       text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
