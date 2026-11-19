-- Schemalagda rapporter (resultat- och balansräkning som Excel) till ägare, bank eller styrelse
CREATE TABLE report_schedules (
  id         serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by int REFERENCES users(id) ON DELETE SET NULL,
  recipients text[] NOT NULL,
  day        int NOT NULL CHECK (day BETWEEN 1 AND 28),
  compare    text NOT NULL DEFAULT 'fjol' CHECK (compare IN ('none','fjol','budget')),
  last_sent  date,
  created_at timestamptz NOT NULL DEFAULT now()
);
