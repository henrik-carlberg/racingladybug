-- E-postsammandrag av att göra-listan
ALTER TABLE users ADD COLUMN digest text NOT NULL DEFAULT 'weekly' CHECK (digest IN ('daily','weekly','off'));
ALTER TABLE users ADD COLUMN digest_sent_at timestamptz;
ALTER TABLE users ADD COLUMN unsubscribe_token text UNIQUE;
