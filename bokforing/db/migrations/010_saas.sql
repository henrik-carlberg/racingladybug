-- SaaS-grund: abonnemang med provperiod, anställda som användare och fakturor som skickas med länk.

-- Rollen "employee" (självservice för anställda)
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'accountant', 'employee'));
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK (role IN ('owner', 'accountant', 'employee'));
ALTER TABLE invites ADD COLUMN employee_id integer REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE employees ADD COLUMN user_id integer REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX employees_user ON employees(company_id, user_id) WHERE user_id IS NOT NULL;

-- Abonnemang per bolag
ALTER TABLE companies ADD COLUMN billing_exempt boolean NOT NULL DEFAULT false;
UPDATE companies SET billing_exempt = true;   -- bolag som fanns innan abonnemangen infördes betalar inte
CREATE TABLE subscriptions (
  company_id             integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  trial_ends_at          date NOT NULL,
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     date,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  monthly_amount         bigint,                     -- öre exkl. moms enligt senaste avstämning mot Stripe
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Fakturor som skickas till kund
ALTER TABLE invoices ADD COLUMN public_token text UNIQUE;
ALTER TABLE invoices ADD COLUMN sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN sent_to text;
