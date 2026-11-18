-- Kortbetalning av kundfakturor via Stripe Connect, och byråvy för redovisningskonsulter

ALTER TABLE companies
  ADD COLUMN stripe_account_id text UNIQUE,
  ADD COLUMN stripe_charges_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE invoice_checkouts (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id  integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  session_id  text NOT NULL UNIQUE,
  amount      bigint NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','expired','mismatch')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  paid_at     timestamptz
);
CREATE INDEX invoice_checkouts_invoice ON invoice_checkouts (invoice_id);

-- Byråer
CREATE TABLE firms (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  orgnr       text NOT NULL DEFAULT '',
  code        text NOT NULL UNIQUE,                 -- kod som klienten anger för att ge byrån åtkomst
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE firm_members (
  firm_id    integer NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, user_id)
);
CREATE TABLE firm_invites (
  id          serial PRIMARY KEY,
  firm_id     integer NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE firm_clients (
  firm_id      integer NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  granted_by   integer REFERENCES users(id) ON DELETE SET NULL,
  responsible  integer REFERENCES users(id) ON DELETE SET NULL,   -- ansvarig konsult på byrån
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, company_id)
);
CREATE INDEX firm_clients_company ON firm_clients (company_id);

-- Frågor från byrån till kunden (t.ex. "vad är den här transaktionen?")
CREATE TABLE client_questions (
  id           serial PRIMARY KEY,
  company_id   integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  firm_id      integer REFERENCES firms(id) ON DELETE SET NULL,
  entity       text,                                   -- bank_transaction | voucher | supplier_invoice | invoice
  entity_id    integer,
  question     text NOT NULL,
  answer       text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  asked_by     integer REFERENCES users(id) ON DELETE SET NULL,
  answered_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz
);
CREATE INDEX client_questions_company ON client_questions (company_id, status);
