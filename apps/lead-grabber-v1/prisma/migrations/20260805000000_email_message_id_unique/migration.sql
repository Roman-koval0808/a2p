-- Belt-and-suspenders: the durable claim (email_sync_claims) stops a second instance
-- from logging the same Gmail message, but if the claim guard is ever bypassed or the
-- table reset, this unique index rejects a duplicate (companyId, email_message_id) pair
-- at the database level. Partial: rows without a message id (drafts, Brevo sends) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS communication_logs_company_email_msg_key
  ON communication_logs ("companyId", (metadata->>'email_message_id'))
  WHERE metadata->>'email_message_id' IS NOT NULL;
