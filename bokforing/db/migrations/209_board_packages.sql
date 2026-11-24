-- Styrelsepaket: ögonblicksbild per period med resultat mot budget, kassa, nyckeltal och larm, öppna beslut, internkontroll och risker
CREATE TABLE IF NOT EXISTS board_packages (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  data jsonb NOT NULL,
  comment text NOT NULL DEFAULT '',
  document_id integer REFERENCES documents(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS board_package_comments (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES board_packages(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
