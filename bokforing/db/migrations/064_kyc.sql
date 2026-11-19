-- Kundkännedom (penningtvättslagen) per byrå och klient, med historik, verkliga huvudmän och uppdragsbrev
CREATE TABLE firm_kyc (
  firm_id         integer NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  risk            text CHECK (risk IN ('low','normal','high')),
  score           integer,
  factors         text[] NOT NULL DEFAULT '{}',
  pep             boolean,
  pep_details     text NOT NULL DEFAULT '',
  identified      text CHECK (identified IN ('bankid','meeting','remote')),
  purpose         text NOT NULL DEFAULT '',
  notes           text NOT NULL DEFAULT '',
  owners          jsonb NOT NULL DEFAULT '[]',
  owners_fetched_at timestamptz,
  assessed_by     integer REFERENCES users(id) ON DELETE SET NULL,
  assessed_at     date,
  next_review     date,
  reminded_for    date,
  engagement_document_id integer REFERENCES documents(id) ON DELETE SET NULL,
  PRIMARY KEY (firm_id, company_id)
);
CREATE TABLE firm_kyc_history (
  id          serial PRIMARY KEY,
  firm_id     integer NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  snapshot    jsonb NOT NULL,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firm_kyc_history_client ON firm_kyc_history (firm_id, company_id, created_at DESC);
