-- Historik över byten av redovisningsmetod (kontantmetoden/faktureringsmetoden)
CREATE TABLE IF NOT EXISTS accounting_method_changes (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_method text NOT NULL,
  to_method text NOT NULL,
  changed_by integer REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
