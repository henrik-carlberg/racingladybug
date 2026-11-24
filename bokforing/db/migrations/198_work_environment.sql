-- Systematiskt arbetsmiljöarbete (AFS 2023:1): riskbedömningar med åtgärder, tillbud och arbetsskador med anmälningsplikt, årlig uppföljning
CREATE TABLE IF NOT EXISTS work_risks (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  area text NOT NULL,
  hazard text NOT NULL,
  probability integer NOT NULL CHECK (probability BETWEEN 1 AND 5),
  consequence integer NOT NULL CHECK (consequence BETWEEN 1 AND 5),
  measure text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  due_date date,
  done_on date,
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS work_incidents (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('near_miss', 'injury', 'serious', 'disease')),
  description text NOT NULL,
  employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  days_absent integer NOT NULL DEFAULT 0 CHECK (days_absent >= 0),
  reported_av_on date,
  reported_fk_on date,
  measure text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sam_reviews (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  checked text[] NOT NULL DEFAULT '{}',
  note text NOT NULL DEFAULT '',
  done_on date,
  PRIMARY KEY (company_id, year)
);
