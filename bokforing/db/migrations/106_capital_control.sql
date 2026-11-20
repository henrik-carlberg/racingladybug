-- Kontrollbalansräkningar, kontrollstämmor och likvidation (ABL 25 kap.)
CREATE TABLE IF NOT EXISTS control_balance_sheets (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  share_capital bigint NOT NULL,
  booked_equity bigint NOT NULL,
  untaxed bigint NOT NULL DEFAULT 0,
  adjustments jsonb NOT NULL DEFAULT '[]',
  equity bigint NOT NULL,
  deficit boolean NOT NULL,
  audited_by text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'drawn' CHECK (stage IN ('drawn', 'first_meeting', 'restored', 'liquidation', 'second_meeting')),
  first_meeting date,
  second_meeting date,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS control_balance_sheets_company ON control_balance_sheets (company_id, date DESC);

CREATE TABLE IF NOT EXISTS liquidations (
  company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  decided_on date NOT NULL,
  liquidator text NOT NULL,
  reason text NOT NULL DEFAULT 'voluntary' CHECK (reason IN ('voluntary', 'capital')),
  registered_on date,
  creditor_notice_on date,
  final_report_on date,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
