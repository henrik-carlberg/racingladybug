-- Sanktionslistekontroll: uppladdade listor (EU, FN), kontroll av kunder och leverantörer, granskning av träffar och stopp vid sann träff
CREATE TABLE IF NOT EXISTS sanction_lists (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('EU', 'UN', 'OTHER')),
  filename text NOT NULL DEFAULT '',
  entries integer NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sanction_entries (
  id serial PRIMARY KEY,
  list_id integer NOT NULL REFERENCES sanction_lists(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized text NOT NULL
);
CREATE INDEX IF NOT EXISTS sanction_entries_company ON sanction_entries (company_id);
CREATE TABLE IF NOT EXISTS sanction_screenings (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer', 'supplier')),
  party_id integer NOT NULL,
  party_name text NOT NULL,
  screened_at timestamptz NOT NULL DEFAULT now(),
  hits jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('clear', 'potential', 'false_positive', 'confirmed')),
  note text NOT NULL DEFAULT '',
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamptz,
  UNIQUE (company_id, party_type, party_id)
);
