-- Byråns månadsbokslut per klient, byråns egen tid per klient och fakturering av den
CREATE TABLE month_closes (
  firm_id    int NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period     text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  done_by    int REFERENCES users(id) ON DELETE SET NULL,
  done_at    timestamptz,
  note       text NOT NULL DEFAULT '',
  reminded_at timestamptz,
  PRIMARY KEY (firm_id, company_id, period)
);
CREATE TABLE firm_time (
  id          serial PRIMARY KEY,
  firm_id     int NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  company_id  int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     int REFERENCES users(id) ON DELETE SET NULL,
  date        date NOT NULL,
  minutes     int NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  description text NOT NULL DEFAULT '',
  invoice_id  int REFERENCES invoices(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firm_time_client ON firm_time (firm_id, company_id, date);
ALTER TABLE firm_clients ADD COLUMN hourly_rate bigint;      -- öre per timme, exkl. moms
ALTER TABLE firms ADD COLUMN own_company_id int REFERENCES companies(id) ON DELETE SET NULL; -- byråns eget bolag (fakturerar klienterna)
