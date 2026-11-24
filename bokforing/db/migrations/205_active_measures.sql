-- Aktiva åtgärder mot diskriminering (diskrimineringslagen 3 kap.): undersökning, analys, åtgärder och uppföljning inom fem områden, riktlinjer mot trakasserier
CREATE TABLE IF NOT EXISTS active_measures (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  area text NOT NULL CHECK (area IN ('conditions', 'pay', 'recruitment', 'training', 'parenthood')),
  finding text NOT NULL,
  measure text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  due_date date,
  done_on date,
  follow_up text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS active_measures_company ON active_measures (company_id, year);
CREATE TABLE IF NOT EXISTS harassment_policies (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  guidelines text NOT NULL,
  routines text NOT NULL,
  adopted_on date NOT NULL,
  updated_by integer REFERENCES users(id)
);
