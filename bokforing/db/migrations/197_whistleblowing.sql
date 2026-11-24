-- Visselblåsarkanal (lag 2021:890): anonym rapportering via publik länk med ärendekod, bekräftelse inom 7 dagar,
-- återkoppling inom 3 månader, åtkomst bara för utsedda handläggare och gallring senast två år efter avslut
CREATE TABLE IF NOT EXISTS whistle_settings (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS whistle_handlers (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, user_id)
);
CREATE TABLE IF NOT EXISTS whistle_reports (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  category text NOT NULL,
  body_enc text NOT NULL,
  contact_enc text,
  received_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  feedback_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  outcome_enc text
);
CREATE INDEX IF NOT EXISTS whistle_reports_company ON whistle_reports (company_id, status);
CREATE TABLE IF NOT EXISTS whistle_messages (
  id serial PRIMARY KEY,
  report_id integer NOT NULL REFERENCES whistle_reports(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('reporter', 'handler')),
  body_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whistle_messages_report ON whistle_messages (report_id, id);
