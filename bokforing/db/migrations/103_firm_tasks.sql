-- Byråns arbetsflöde: uppgifter per kund (från bolagets deadlines eller egna) med ansvarig kollega
CREATE TABLE firm_tasks (
  id            serial PRIMARY KEY,
  firm_id       integer NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  company_id    integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  deadline_key  text,
  title         text NOT NULL,
  due           date NOT NULL,
  assignee      integer REFERENCES users(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  done_by       integer REFERENCES users(id) ON DELETE SET NULL,
  done_at       timestamptz,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX firm_tasks_deadline ON firm_tasks (firm_id, company_id, deadline_key) WHERE deadline_key IS NOT NULL;
CREATE INDEX firm_tasks_firm ON firm_tasks (firm_id, status, due);
