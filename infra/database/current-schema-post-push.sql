-- `prisma db push` creates the current relational schema for a brand-new
-- installation, but it cannot express the generated catalog-code triggers.
-- Keep this file idempotent so empty-database bootstrapping and CI behave the
-- same way as databases that reached the current schema through migrations.

CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_bq_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_sj_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_tz_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "calculation_parameter_pz_seq" START 1;

CREATE OR REPLACE FUNCTION "assign_calculation_parameter_code"()
RETURNS TRIGGER AS $$
DECLARE
  prefix_value VARCHAR(2);
  next_value BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."parameter_code" IS DISTINCT FROM OLD."parameter_code" THEN
    RAISE EXCEPTION 'parameter_code cannot be changed';
  END IF;

  IF NEW."parameter_code" IS NULL OR NEW."parameter_code" = '' THEN
    prefix_value := CASE NEW."category"
      WHEN 'bill' THEN 'BQ'
      WHEN 'event' THEN 'SJ'
      ELSE 'PZ'
    END;
    next_value := CASE prefix_value
      WHEN 'BQ' THEN nextval('"calculation_parameter_bq_seq"')
      WHEN 'SJ' THEN nextval('"calculation_parameter_sj_seq"')
      ELSE nextval('"calculation_parameter_pz_seq"')
    END;
    IF next_value > 9999 THEN
      RAISE EXCEPTION 'calculation parameter code sequence exhausted for prefix %', prefix_value;
    END IF;
    NEW."parameter_code" := prefix_value || LPAD(next_value::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_assign_calculation_parameter_code" ON "calculation_parameter_catalog";
CREATE TRIGGER "trg_assign_calculation_parameter_code"
BEFORE INSERT OR UPDATE OF "parameter_code" ON "calculation_parameter_catalog"
FOR EACH ROW EXECUTE FUNCTION "assign_calculation_parameter_code"();

CREATE OR REPLACE FUNCTION "assign_calculation_ledger_parameter_code"()
RETURNS TRIGGER AS $$
DECLARE
  next_value BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."parameter_code" IS DISTINCT FROM OLD."parameter_code" THEN
    RAISE EXCEPTION 'parameter_code cannot be changed';
  END IF;
  IF NEW."parameter_code" IS NULL OR NEW."parameter_code" = '' THEN
    next_value := nextval('"calculation_parameter_tz_seq"');
    IF next_value > 9999 THEN
      RAISE EXCEPTION 'calculation ledger parameter code sequence exhausted';
    END IF;
    NEW."parameter_code" := 'TZ' || LPAD(next_value::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_assign_calculation_ledger_parameter_code" ON "calculation_ledger_parameter_catalog";
CREATE TRIGGER "trg_assign_calculation_ledger_parameter_code"
BEFORE INSERT OR UPDATE OF "parameter_code" ON "calculation_ledger_parameter_catalog"
FOR EACH ROW EXECUTE FUNCTION "assign_calculation_ledger_parameter_code"();
