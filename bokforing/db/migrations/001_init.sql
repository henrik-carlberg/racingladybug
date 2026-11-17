-- Grundschema. Alla belopp lagras i öre (bigint) för att undvika avrundningsfel.

CREATE TABLE users (
  id            serial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          text PRIMARY KEY,           -- sha256 av sessionstoken
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE companies (
  id              serial PRIMARY KEY,
  name            text NOT NULL,
  orgnr           text NOT NULL,
  company_type    text NOT NULL CHECK (company_type IN ('AB','EF')),
  vat_period      text NOT NULL DEFAULT 'quarter' CHECK (vat_period IN ('month','quarter','year')),
  address         text NOT NULL DEFAULT '',
  postal_code     text NOT NULL DEFAULT '',
  city            text NOT NULL DEFAULT '',
  email           text NOT NULL DEFAULT '',
  phone           text NOT NULL DEFAULT '',
  vat_number      text NOT NULL DEFAULT '',
  bankgiro        text NOT NULL DEFAULT '',
  plusgiro        text NOT NULL DEFAULT '',
  iban            text NOT NULL DEFAULT '',
  f_skatt         boolean NOT NULL DEFAULT true,
  invoice_terms   integer NOT NULL DEFAULT 30,
  late_interest   text NOT NULL DEFAULT 'Dröjsmålsränta enligt räntelagen',
  locked_until    date,                    -- periodlås: inga verifikationer på eller före detta datum
  next_invoice_no integer NOT NULL DEFAULT 1001,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','accountant')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE invites (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('owner','accountant')),
  token_hash  text NOT NULL UNIQUE,
  created_by  integer NOT NULL REFERENCES users(id),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz
);

CREATE TABLE fiscal_years (
  id         serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  closed     boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, start_date),
  CHECK (end_date > start_date)
);

CREATE TABLE accounts (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number     integer NOT NULL CHECK (number BETWEEN 1000 AND 9999),
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, number)
);

-- Verifikationer är oföränderliga när de väl är bokförda (BFL 5 kap).
-- Rättelser görs med en ny verifikation (rättelseverifikation) som refererar till originalet.
CREATE TABLE vouchers (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id  integer NOT NULL REFERENCES fiscal_years(id),
  series          text NOT NULL DEFAULT 'A',
  number          integer NOT NULL,
  date            date NOT NULL,
  description     text NOT NULL,
  source_type     text,                    -- 'invoice','invoice_payment','supplier_invoice','supplier_payment','payroll','vat','manual','reversal'
  source_id       integer,
  corrects_id     integer REFERENCES vouchers(id),
  created_by      integer NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, fiscal_year_id, series, number)
);

CREATE TABLE voucher_lines (
  id             serial PRIMARY KEY,
  voucher_id     integer NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  account_number integer NOT NULL,
  debit          bigint NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         bigint NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description    text NOT NULL DEFAULT ''
);
CREATE INDEX voucher_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX vouchers_company_date ON vouchers(company_id, date);

-- Underlag (kvitton, fakturor) kopplade till verifikationer eller leverantörsfakturor.
CREATE TABLE attachments (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  voucher_id  integer REFERENCES vouchers(id),
  supplier_invoice_id integer,
  filename    text NOT NULL,
  mime_type   text NOT NULL,
  data        bytea NOT NULL,
  uploaded_by integer NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Behandlingshistorik
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  company_id integer REFERENCES companies(id) ON DELETE CASCADE,
  user_id    integer REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  integer,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Kunder och kundfakturor
CREATE TABLE customers (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  orgnr           text NOT NULL DEFAULT '',
  vat_number      text NOT NULL DEFAULT '',
  email           text NOT NULL DEFAULT '',
  address         text NOT NULL DEFAULT '',
  postal_code     text NOT NULL DEFAULT '',
  city            text NOT NULL DEFAULT '',
  country         text NOT NULL DEFAULT 'SE',
  payment_terms   integer,
  reverse_charge  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id                 serial PRIMARY KEY,
  company_id         integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id        integer NOT NULL REFERENCES customers(id),
  invoice_number     integer,                 -- tilldelas när fakturan bokförs
  invoice_date       date NOT NULL,
  due_date           date NOT NULL,
  delivery_date      text NOT NULL DEFAULT '',     -- leveransdatum/period om annat än fakturadatum
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','booked','paid','credited')),
  ocr                text,
  our_reference      text NOT NULL DEFAULT '',
  your_reference     text NOT NULL DEFAULT '',
  notes              text NOT NULL DEFAULT '',
  reverse_charge     boolean NOT NULL DEFAULT false,
  total_net          bigint NOT NULL DEFAULT 0,
  total_vat          bigint NOT NULL DEFAULT 0,
  rounding           bigint NOT NULL DEFAULT 0,
  total              bigint NOT NULL DEFAULT 0,
  credit_of_id       integer REFERENCES invoices(id),
  voucher_id         integer REFERENCES vouchers(id),
  payment_voucher_id integer REFERENCES vouchers(id),
  paid_date          date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_number)
);

CREATE TABLE invoice_lines (
  id             serial PRIMARY KEY,
  invoice_id     integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position       integer NOT NULL,
  description    text NOT NULL,
  quantity       numeric(12,3) NOT NULL DEFAULT 1,
  unit           text NOT NULL DEFAULT 'st',
  unit_price     bigint NOT NULL,            -- öre exkl moms
  vat_rate       integer NOT NULL CHECK (vat_rate IN (0,6,12,25)),
  account_number integer NOT NULL
);

-- Leverantörer och leverantörsfakturor
CREATE TABLE suppliers (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            text NOT NULL,
  orgnr           text NOT NULL DEFAULT '',
  bankgiro        text NOT NULL DEFAULT '',
  plusgiro        text NOT NULL DEFAULT '',
  bank_account    text NOT NULL DEFAULT '',
  default_account integer NOT NULL DEFAULT 4010,
  email           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE supplier_invoices (
  id                 serial PRIMARY KEY,
  company_id         integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id        integer NOT NULL REFERENCES suppliers(id),
  invoice_number     text NOT NULL,
  invoice_date       date NOT NULL,
  due_date           date NOT NULL,
  payment_reference  text NOT NULL DEFAULT '',   -- OCR eller meddelande
  description        text NOT NULL DEFAULT '',
  total              bigint NOT NULL,            -- att betala inkl moms
  vat                bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','approved','paid')),
  approved_by        integer REFERENCES users(id),
  approved_at        timestamptz,
  voucher_id         integer REFERENCES vouchers(id),
  payment_voucher_id integer REFERENCES vouchers(id),
  paid_date          date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, supplier_id, invoice_number)
);

ALTER TABLE attachments ADD CONSTRAINT attachments_sinv FOREIGN KEY (supplier_invoice_id) REFERENCES supplier_invoices(id);

-- Lön
CREATE TABLE employees (
  id               serial PRIMARY KEY,
  company_id       integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  personal_number  text NOT NULL,              -- ÅÅÅÅMMDDNNNN
  email            text NOT NULL DEFAULT '',
  address          text NOT NULL DEFAULT '',
  postal_code      text NOT NULL DEFAULT '',
  city             text NOT NULL DEFAULT '',
  bank_clearing    text NOT NULL DEFAULT '',
  bank_account     text NOT NULL DEFAULT '',
  employment_start date,
  employment_end   date,
  monthly_salary   bigint NOT NULL DEFAULT 0,
  tax_mode         text NOT NULL DEFAULT 'table' CHECK (tax_mode IN ('table','percent')),
  tax_table        integer,                    -- t.ex. 32
  tax_column       integer NOT NULL DEFAULT 1, -- 1 = vanlig lön under 66 år
  tax_percent      numeric(5,2),               -- vid sidoinkomst/jämkning, t.ex. 30
  fee_override     numeric(5,2),               -- avvikande arbetsgivaravgift i procent (t.ex. växa-stöd)
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, personal_number)
);

-- Skatteverkets skattetabeller (månadslön, "30B" = belopp, "30%" = procent)
CREATE TABLE tax_table_rows (
  year        integer NOT NULL,
  table_no    integer NOT NULL,
  income_from integer NOT NULL,   -- kronor
  income_to   integer NOT NULL,   -- kronor
  kind        text NOT NULL CHECK (kind IN ('B','%')),
  columns     integer[] NOT NULL, -- skatt (kr) eller procent per kolumn 1..N
  PRIMARY KEY (year, table_no, income_from, kind)
);

CREATE TABLE payroll_runs (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period       text NOT NULL,            -- 'YYYY-MM' (redovisningsperiod för AGI)
  payment_date date NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','booked')),
  voucher_id   integer REFERENCES vouchers(id),
  booked_by    integer REFERENCES users(id),
  booked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period)
);

CREATE TABLE payslips (
  id              serial PRIMARY KEY,
  run_id          integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id     integer NOT NULL REFERENCES employees(id),
  items           jsonb NOT NULL DEFAULT '[]',   -- [{type, description, amount}]
  gross_cash      bigint NOT NULL DEFAULT 0,     -- kontant bruttolön (AGI ruta 011)
  benefits        bigint NOT NULL DEFAULT 0,     -- skattepliktiga förmåner (AGI ruta 012)
  tax             bigint NOT NULL DEFAULT 0,     -- avdragen preliminärskatt (AGI ruta 001)
  net_deductions  bigint NOT NULL DEFAULT 0,     -- nettolöneavdrag
  reimbursements  bigint NOT NULL DEFAULT 0,     -- skattefria utlägg/ersättningar
  net_pay         bigint NOT NULL DEFAULT 0,
  employer_fee_rate numeric(5,2) NOT NULL,
  employer_fee    bigint NOT NULL DEFAULT 0,
  UNIQUE (run_id, employee_id)
);
