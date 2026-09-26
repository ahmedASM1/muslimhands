-- Phase 6C: audit log immutability at the database layer.
-- Application code already only inserts/lists; this prevents UPDATE/DELETE even via raw SQL clients.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_immutable_update ON "audit_logs";
DROP TRIGGER IF EXISTS audit_logs_immutable_delete ON "audit_logs";

CREATE TRIGGER audit_logs_immutable_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE PROCEDURE prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_immutable_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE PROCEDURE prevent_audit_log_mutation();
