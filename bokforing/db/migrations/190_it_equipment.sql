-- IT-utrustning och inventarielista: vem som har vad, garanti, utbytesplan och återlämning vid uppsägning
CREATE TABLE IF NOT EXISTS it_equipment (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('laptop', 'phone', 'tablet', 'screen', 'accessory', 'other')),
  name text NOT NULL,
  serial text NOT NULL DEFAULT '',
  purchased_on date,
  cost bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
  warranty_until date,
  asset_id integer REFERENCES assets(id) ON DELETE SET NULL,
  employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  assigned_on date,
  status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_use', 'in_stock', 'retired', 'lost')),
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS it_equipment_company ON it_equipment (company_id);
CREATE INDEX IF NOT EXISTS it_equipment_employee ON it_equipment (employee_id);
CREATE TABLE IF NOT EXISTS it_equipment_log (
  id serial PRIMARY KEY,
  equipment_id integer NOT NULL REFERENCES it_equipment(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('assigned', 'returned', 'lost', 'retired')),
  employee_id integer REFERENCES employees(id) ON DELETE SET NULL,
  at date NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by integer REFERENCES users(id)
);
