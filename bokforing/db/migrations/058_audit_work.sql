-- Revisorns arbetsyta: granskning per räkenskapsår, stickprov och kontrollpunkter
CREATE TABLE audit_engagements (
  id              serial PRIMARY KEY,
  company_id      integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  fiscal_year_id  integer NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  materiality     bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  conclusion      text NOT NULL DEFAULT '',
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  UNIQUE (company_id, fiscal_year_id)
);
CREATE TABLE audit_samples (
  id             serial PRIMARY KEY,
  engagement_id  integer NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  voucher_id     integer NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  method         text NOT NULL,
  reason         text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','remark')),
  comment        text NOT NULL DEFAULT '',
  sent_at        timestamptz,
  reviewed_by    integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  UNIQUE (engagement_id, voucher_id)
);
CREATE TABLE audit_checkpoints (
  id             serial PRIMARY KEY,
  engagement_id  integer NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  key            text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','remark')),
  comment        text NOT NULL DEFAULT '',
  sent_at        timestamptz,
  reviewed_by    integer REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  UNIQUE (engagement_id, key)
);
