-- Custom migration: triggers Drizzle can't express in the schema.
-- (1) DB-level backstop for the "cannot cancel a shipped order" guardrail.
-- (2) pg_notify on escalation changes -> powers the long-poll live updates (V5).

CREATE OR REPLACE FUNCTION assert_order_not_shipped() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.shipped_at IS NOT NULL) THEN
    RAISE EXCEPTION 'order % already shipped', NEW.order_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_cancellation_not_shipped ON cancellations;
--> statement-breakpoint
CREATE TRIGGER trg_cancellation_not_shipped
  BEFORE INSERT ON cancellations
  FOR EACH ROW EXECUTE FUNCTION assert_order_not_shipped();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION notify_escalations_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'escalations_changed',
    json_build_object('id', NEW.id, 'status', NEW.status, 'version', NEW.version)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_escalations_notify ON escalations;
--> statement-breakpoint
CREATE TRIGGER trg_escalations_notify
  AFTER INSERT OR UPDATE ON escalations
  FOR EACH ROW EXECUTE FUNCTION notify_escalations_changed();
