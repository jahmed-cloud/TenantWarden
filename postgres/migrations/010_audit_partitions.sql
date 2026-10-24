-- ─── 010: audit_logs partition maintenance ───────────────────────────────────
-- 001 only created yearly partitions for 2024–2026. Once the calendar passes the
-- last partition every INSERT INTO audit_logs fails — and login writes one.
--
-- ensure_audit_log_partitions() creates yearly partitions ahead of time; the
-- scheduler calls it daily. audit_logs_default is a safety net so inserts never
-- fail even if the job stops running. If rows for a year do land in the default
-- partition, creating that year's partition later raises a WARNING (it cannot be
-- created while matching rows sit in the default) and inserts keep working; to fix,
-- DETACH the default, create the partition, move the rows across, then re-attach.

CREATE OR REPLACE FUNCTION ensure_audit_log_partitions(years_ahead INT DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  this_year INT := EXTRACT(YEAR FROM NOW())::INT;
  y         INT;
  part      TEXT;
BEGIN
  FOR y IN this_year .. this_year + years_ahead LOOP
    part := format('audit_logs_%s', y);
    IF to_regclass(part) IS NULL THEN
      BEGIN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
          part, make_date(y, 1, 1), make_date(y + 1, 1, 1));
      EXCEPTION WHEN others THEN
        RAISE WARNING 'could not create partition %: %', part, SQLERRM;
      END;
    END IF;
  END LOOP;
END; $$;

-- Current year + 2 (on first run in 2026: 2026, 2027, 2028)
SELECT ensure_audit_log_partitions(2);

CREATE TABLE IF NOT EXISTS audit_logs_default PARTITION OF audit_logs DEFAULT;
