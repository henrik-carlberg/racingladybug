-- Företagskort: kortkonton med kortinnehavare, påminnelser om kvitton som saknas
ALTER TABLE bank_accounts ADD COLUMN is_card boolean NOT NULL DEFAULT false,
  ADD COLUMN card_holder_user_id integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bank_transactions ADD COLUMN receipt_reminded_at timestamptz;
