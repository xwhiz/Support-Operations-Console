-- Harden the cancellation backstop: an order that has shipped OR been delivered
-- cannot be cancelled (delivery implies shipment). Updates the function body;
-- the BEFORE INSERT trigger on cancellations already points at it.
CREATE OR REPLACE FUNCTION assert_order_not_shipped() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = NEW.order_id
      AND (o.shipped_at IS NOT NULL OR o.delivered_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'order % already shipped or delivered', NEW.order_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
