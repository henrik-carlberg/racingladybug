-- Dataskydd: egna behandlingar i registret enligt art. 30 och personuppgiftsincidenter med 72-timmarsfristen (art. 33–34)
CREATE TABLE IF NOT EXISTS processing_activities (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  subjects text NOT NULL,
  categories text NOT NULL,
  purpose text NOT NULL DEFAULT '',
  legal_basis text NOT NULL,
  recipients text NOT NULL DEFAULT '',
  retention text NOT NULL DEFAULT '',
  sensitive boolean NOT NULL DEFAULT false,
  third_country boolean NOT NULL DEFAULT false,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS data_incidents (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  discovered_at timestamptz NOT NULL,
  description text NOT NULL,
  categories text NOT NULL DEFAULT '',
  subjects_count integer NOT NULL DEFAULT 0 CHECK (subjects_count >= 0),
  risk text NOT NULL CHECK (risk IN ('none', 'risk', 'high')),
  consequences text NOT NULL DEFAULT '',
  measures text NOT NULL DEFAULT '',
  reported_imy_at timestamptz,
  imy_ref text NOT NULL DEFAULT '',
  late_reason text NOT NULL DEFAULT '',
  subjects_informed_at timestamptz,
  closed_on date,
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS data_incidents_company ON data_incidents (company_id, discovered_at);
