-- S6-4 (Sprint 6, BE-14): how late timer messages are, and whether the worker keeps up (D-057).
--
-- GET /health/full reads one summary through this function. It returns only counts and times:
-- nothing about people or recipes. The sign-in role (cookbook_system) may call it; it cannot read
-- the outbox itself.
--
-- A timer message's delay: from the timer's end (payload.ends_at, written when it fires) to when
-- Telegram took it (sent_at). "Late" is over 5 seconds (PRD 7.1). "Overdue" is a message that
-- should have gone more than 2 minutes ago and was not even tried: the worker is down or stuck.

CREATE FUNCTION delivery_health() RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH recent AS (
    SELECT status,
           CASE WHEN status = 'sent' AND payload ? 'ends_at'
                THEN extract(epoch FROM sent_at - (payload ->> 'ends_at')::timestamptz) * 1000
           END AS delay_ms
      FROM notification_outbox
     WHERE type = 'timer_fired'
       AND coalesce(sent_at, created_at) > now() - interval '1 hour'
  ), sent AS (
    SELECT greatest(delay_ms, 0) AS d FROM recent WHERE delay_ms IS NOT NULL
  )
  SELECT jsonb_build_object(
    'overdue_messages', (
      SELECT count(*) FROM notification_outbox
       WHERE (status = 'pending' AND run_at < now() - interval '2 minutes')
          OR (status = 'sending' AND locked_until < now() - interval '2 minutes')),
    'sent', (SELECT count(*) FROM sent),
    'late', (SELECT count(*) FROM sent WHERE d > 5000),
    'failed', (SELECT count(*) FROM recent WHERE status IN ('failed', 'blocked')),
    'p50_ms', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY d)) FROM sent),
    'p95_ms', (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY d)) FROM sent),
    'max_ms', (SELECT round(max(d)) FROM sent)
  ) $$;

REVOKE ALL ON FUNCTION delivery_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delivery_health() TO cookbook_system;
