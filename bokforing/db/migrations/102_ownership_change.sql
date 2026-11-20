-- Ägarbyte: överlåtelsens typ och skatteuppgifter i aktieboken, aktieägartillskott
ALTER TABLE share_events DROP CONSTRAINT IF EXISTS share_events_kind_check;
ALTER TABLE share_events ADD CONSTRAINT share_events_kind_check CHECK (kind IN ('founding','transfer','issue','contribution'));
CREATE TABLE shareholder_contributions (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  owner_id    integer NOT NULL REFERENCES company_owners(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('ovillkorat','villkorat')),
  amount      bigint NOT NULL CHECK (amount > 0),
  date        date NOT NULL,
  voucher_id  integer REFERENCES vouchers(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
