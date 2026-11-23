-- Konvertibler och teckningsoptioner: villkor, emissionslikvid, periodiserad ränta, konvertering eller teckning till nya aktier och utspädning
CREATE TABLE IF NOT EXISTS share_instruments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('convertible','warrant')),
  holder_name text NOT NULL,
  holder_id text NOT NULL DEFAULT '',
  issued_on date NOT NULL,
  expires_on date NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 0), -- konvertibelns lånebelopp eller optionspremien
  shares integer NOT NULL CHECK (shares > 0), -- aktier vid full konvertering eller teckning
  strike bigint NOT NULL CHECK (strike > 0), -- konverterings- eller teckningskurs per aktie
  interest_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (interest_pct >= 0),
  interest_booked bigint NOT NULL DEFAULT 0,
  interest_until date,
  share_class text NOT NULL DEFAULT 'B' CHECK (share_class IN ('A','B')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','converted','exercised','repaid','expired')),
  closed_on date,
  issue_voucher_id integer REFERENCES vouchers(id),
  close_voucher_id integer REFERENCES vouchers(id),
  created_by integer REFERENCES users(id),
  CHECK (expires_on > issued_on)
);
