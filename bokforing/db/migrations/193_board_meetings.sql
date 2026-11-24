-- Styrelsemöten och stämmor: dagordning, beslut med ansvarig och uppföljning, beslutförhet och protokoll för justering
CREATE TABLE IF NOT EXISTS board_meetings (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('board', 'agm', 'egm')),
  date date NOT NULL,
  place text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'held', 'sent')),
  chair text NOT NULL DEFAULT '',
  secretary text NOT NULL DEFAULT '',
  present text[] NOT NULL DEFAULT '{}',
  document_id integer REFERENCES documents(id) ON DELETE SET NULL,
  created_by integer REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS board_meetings_company ON board_meetings (company_id, date);
CREATE TABLE IF NOT EXISTS board_items (
  id serial PRIMARY KEY,
  meeting_id integer NOT NULL REFERENCES board_meetings(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  position integer NOT NULL,
  template text NOT NULL DEFAULT 'other',
  title text NOT NULL,
  decision text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  due_date date,
  done_on date
);
CREATE INDEX IF NOT EXISTS board_items_meeting ON board_items (meeting_id, position);
