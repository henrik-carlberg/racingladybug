-- Kommentarer på verifikationer, fakturor, leverantörsfakturor och banktransaktioner, med @nämn
CREATE TABLE comments (
  id         serial PRIMARY KEY,
  company_id int NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity     text NOT NULL CHECK (entity IN ('voucher','invoice','supplier_invoice','bank_transaction')),
  entity_id  int NOT NULL,
  user_id    int REFERENCES users(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_entity ON comments (company_id, entity, entity_id);
CREATE TABLE comment_mentions (
  comment_id int NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at    timestamptz,
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX comment_mentions_unseen ON comment_mentions (user_id) WHERE seen_at IS NULL;
-- Frågor där kunden ska skicka in underlag (kvitto/faktura), och underlaget som skickades
ALTER TABLE client_questions ADD COLUMN needs_document boolean NOT NULL DEFAULT false;
ALTER TABLE attachments ADD COLUMN question_id int REFERENCES client_questions(id) ON DELETE SET NULL;
