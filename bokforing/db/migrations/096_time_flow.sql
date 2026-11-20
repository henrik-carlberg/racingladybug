-- Tid till lön och faktura: klockslag, restid, attest av tid och överföring till lönespecen
ALTER TABLE time_entries ADD COLUMN start_time time, ADD COLUMN end_time time,
  ADD COLUMN kind text NOT NULL DEFAULT 'work' CHECK (kind IN ('work','travel')),
  ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved')),
  ADD COLUMN approved_by integer REFERENCES users(id) ON DELETE SET NULL, ADD COLUMN approved_at timestamptz,
  ADD COLUMN payslip_id integer REFERENCES payslips(id) ON DELETE SET NULL;
CREATE INDEX time_entries_status ON time_entries (company_id, status, date);
ALTER TABLE companies ADD COLUMN time_approval boolean NOT NULL DEFAULT false;
ALTER TABLE collective_agreements ADD COLUMN travel_divisor integer NOT NULL DEFAULT 240 CHECK (travel_divisor BETWEEN 0 AND 400);
