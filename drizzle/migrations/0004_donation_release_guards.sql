ALTER TABLE public.donation_releases
  ADD COLUMN manual_reconciliation_required boolean NOT NULL DEFAULT false,
  ADD COLUMN manual_reconciliation_reason text;
ALTER TABLE public.donations
  ADD COLUMN checkout_first_attempt_at timestamptz,
  ADD COLUMN checkout_manual_review boolean NOT NULL DEFAULT false;

-- first_submitted_at (submitted_at) is the immutable start of THIS idempotency key's window.
CREATE OR REPLACE FUNCTION public.protect_donation_release_window()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL AND NEW.idempotency_key = OLD.idempotency_key
     AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'submission window start is immutable for this idempotency key';
  END IF;
  IF OLD.manual_reconciliation_required AND NOT NEW.manual_reconciliation_required THEN
    RAISE EXCEPTION 'manual reconciliation flag is sticky';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER donation_releases_window BEFORE UPDATE ON public.donation_releases FOR EACH ROW EXECUTE FUNCTION public.protect_donation_release_window();

CREATE OR REPLACE FUNCTION public.protect_donation_checkout_window()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.checkout_first_attempt_at IS NOT NULL AND NEW.checkout_first_attempt_at IS DISTINCT FROM OLD.checkout_first_attempt_at THEN
    RAISE EXCEPTION 'checkout attempt window start is immutable';
  END IF;
  IF OLD.checkout_manual_review AND NOT NEW.checkout_manual_review THEN
    RAISE EXCEPTION 'checkout manual review flag is sticky';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER donations_checkout_window BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.protect_donation_checkout_window();

-- Shared scope: one Stripe platform account + mode + USD, across stores AND integration rows.
CREATE OR REPLACE FUNCTION public.donation_release_reserve(
  _donation_id uuid, _preview_hash text, _confirmed_by text, _amount integer, _fee integer,
  _dest text, _source text, _available_usd bigint, _fee_budget integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.donations%ROWTYPE;
  r public.donation_releases%ROWTYPE;
  has_rel boolean;
  other_held bigint;
  fee_used bigint;
  att integer := 1;
BEGIN
  SELECT * INTO d FROM public.donations WHERE id = _donation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'donation not found'; END IF;
  IF d.platform_account_id IS NULL OR d.integration_id IS NULL THEN RAISE EXCEPTION 'donation has no platform binding'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('donation-release-scope:' || d.platform_account_id || ':' || d.livemode::text || ':USD', 0));
  SELECT * INTO d FROM public.donations WHERE id = _donation_id FOR UPDATE;
  SELECT * INTO r FROM public.donation_releases WHERE donation_id = d.id FOR UPDATE;
  has_rel := FOUND;
  IF has_rel AND r.status = 'SUCCEEDED' THEN
    RETURN jsonb_build_object('action', 'done', 'release_id', r.id, 'transfer_id', r.transfer_id);
  END IF;
  IF has_rel AND r.status IN ('RESERVED','SUBMITTED','UNKNOWN') THEN
    RETURN jsonb_build_object('action', 'resume', 'release_id', r.id, 'idempotency_key', r.idempotency_key,
      'amount_cents', r.amount_cents, 'destination', r.destination_account_id, 'source', r.source_charge_id);
  END IF;
  IF has_rel AND r.manual_reconciliation_required THEN RAISE EXCEPTION 'release requires manual reconciliation'; END IF;
  IF has_rel THEN att := r.attempt + 1; END IF;

  IF d.status <> 'PAID' OR NOT d.payment_confirmed OR d.disputed OR d.refunded_cents <> 0 THEN
    RAISE EXCEPTION 'donation is not releasable (%)', d.status;
  END IF;
  IF d.currency <> 'USD' OR _amount <> d.amount_cents THEN RAISE EXCEPTION 'release must be the full original USD amount'; END IF;
  IF _dest IS DISTINCT FROM (d.beneficiary_snapshot->>'account_id') THEN RAISE EXCEPTION 'destination differs from donation snapshot'; END IF;
  IF _source IS DISTINCT FROM d.charge_id OR _source IS NULL THEN RAISE EXCEPTION 'source charge differs from donation'; END IF;

  SELECT COALESCE(SUM(x.amount_cents - x.refunded_cents), 0) INTO other_held
  FROM public.donations x
  WHERE x.id <> d.id AND x.platform_account_id = d.platform_account_id AND x.livemode = d.livemode AND x.currency = 'USD'
    AND (x.status IN ('PAID','PARTIALLY_REFUNDED','DISPUTED')
         OR EXISTS (SELECT 1 FROM public.donation_releases y WHERE y.donation_id = x.id AND y.status IN ('RESERVED','SUBMITTED','UNKNOWN')));

  SELECT COALESCE(SUM(y.fee_coverage_cents), 0) INTO fee_used
  FROM public.donation_releases y
  WHERE y.platform_account_id = d.platform_account_id AND y.livemode = d.livemode AND y.currency = 'USD'
    AND y.status IN ('RESERVED','SUBMITTED','UNKNOWN','SUCCEEDED');

  IF _available_usd - other_held - _amount < 0 THEN
    RAISE EXCEPTION 'insufficient available USD: % available, % held for other donations, % needed', _available_usd, other_held, _amount;
  END IF;
  IF fee_used + _fee > _fee_budget THEN
    RAISE EXCEPTION 'NGO fee funding deficit: % used, % needed, % budget', fee_used, _fee, _fee_budget;
  END IF;

  IF has_rel THEN
    UPDATE public.donation_releases SET status = 'RESERVED', attempt = att,
      idempotency_key = 'donation-release:' || d.id || ':' || att, amount_cents = _amount, fee_coverage_cents = _fee,
      destination_account_id = _dest, source_charge_id = _source, preview_hash = _preview_hash, confirmed_by = _confirmed_by,
      integration_id = d.integration_id, livemode = d.livemode, platform_account_id = d.platform_account_id,
      error = NULL, adverse_during_release = false, transfer_id = NULL, submitted_at = NULL, resolved_at = NULL
    WHERE id = r.id RETURNING * INTO r;
  ELSE
    INSERT INTO public.donation_releases (donation_id, idempotency_key, amount_cents, fee_coverage_cents, destination_account_id,
      source_charge_id, preview_hash, status, confirmed_by, integration_id, livemode, platform_account_id, attempt)
    VALUES (d.id, 'donation-release:' || d.id || ':' || att, _amount, _fee, _dest, _source, _preview_hash, 'RESERVED',
      _confirmed_by, d.integration_id, d.livemode, d.platform_account_id, att)
    RETURNING * INTO r;
  END IF;
  INSERT INTO public.donation_ledger (donation_id, entry_type, amount_cents, metadata)
  VALUES (d.id, 'RELEASE_RESERVED', _amount, jsonb_build_object('release_id', r.id, 'fee_reserved', _fee, 'attempt', att));
  RETURN jsonb_build_object('action', 'new', 'release_id', r.id, 'idempotency_key', r.idempotency_key,
    'amount_cents', r.amount_cents, 'destination', r.destination_account_id, 'source', r.source_charge_id);
END $$;

-- Final locked guard immediately before any (re)submission of a transfer create.
CREATE OR REPLACE FUNCTION public.donation_release_submit_guard(_release_id uuid, _window_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.donation_releases%ROWTYPE;
  d public.donations%ROWTYPE;
  s public.donation_settings%ROWTYPE;
  reason text;
BEGIN
  SELECT * INTO r FROM public.donation_releases WHERE id = _release_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release not found'; END IF;
  SELECT * INTO d FROM public.donations WHERE id = r.donation_id FOR UPDATE;
  SELECT * INTO s FROM public.donation_settings WHERE store_id = d.store_id;
  IF r.status NOT IN ('RESERVED','SUBMITTED','UNKNOWN') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'release not in flight (' || r.status || ')');
  END IF;
  IF r.manual_reconciliation_required THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'manual reconciliation required: ' || COALESCE(r.manual_reconciliation_reason, ''));
  END IF;
  IF r.submitted_at IS NOT NULL AND now() - r.submitted_at > make_interval(secs => _window_seconds) THEN
    UPDATE public.donation_releases SET manual_reconciliation_required = true,
      manual_reconciliation_reason = 'idempotency window for ' || r.idempotency_key || ' passed' WHERE id = r.id;
    INSERT INTO public.donation_ledger (donation_id, entry_type, amount_cents, metadata)
    VALUES (d.id, 'RELEASE_MANUAL_RECONCILIATION', r.amount_cents, jsonb_build_object('release_id', r.id, 'reason', 'idempotency window passed'));
    RETURN jsonb_build_object('allowed', false, 'reason', 'idempotency window passed; manual reconciliation required');
  END IF;
  reason := CASE
    WHEN NOT d.payment_confirmed OR d.status <> 'PAID' THEN 'donation is ' || d.status
    WHEN d.disputed THEN 'donation is disputed'
    WHEN d.refunded_cents > 0 THEN 'donation has refunds'
    WHEN r.adverse_during_release THEN 'refund or dispute arrived during release'
    WHEN s.id IS NULL OR NOT s.releases_enabled THEN 'releases switch is off'
    WHEN r.platform_account_id IS DISTINCT FROM d.platform_account_id OR r.livemode IS DISTINCT FROM d.livemode
      OR r.integration_id IS DISTINCT FROM d.integration_id THEN 'release binding differs from donation'
    WHEN r.destination_account_id IS DISTINCT FROM (d.beneficiary_snapshot->>'account_id') OR r.amount_cents <> d.amount_cents
      OR r.source_charge_id IS DISTINCT FROM d.charge_id THEN 'release parameters differ from donation'
    ELSE NULL END;
  IF reason IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', reason);
  END IF;
  UPDATE public.donation_releases SET status = 'SUBMITTED', submitted_at = COALESCE(submitted_at, now()) WHERE id = r.id;
  RETURN jsonb_build_object('allowed', true, 'first_submitted_at', COALESCE(r.submitted_at, now()));
END $$;

CREATE OR REPLACE FUNCTION public.donation_release_flag_manual(_release_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.donation_releases%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.donation_releases WHERE id = _release_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release not found'; END IF;
  IF r.status = 'SUCCEEDED' THEN RETURN jsonb_build_object('flagged', false); END IF;
  UPDATE public.donation_releases SET manual_reconciliation_required = true,
    manual_reconciliation_reason = LEFT(_reason, 300), status = CASE WHEN status = 'FAILED' THEN status ELSE 'UNKNOWN' END
  WHERE id = r.id;
  INSERT INTO public.donation_ledger (donation_id, entry_type, amount_cents, metadata)
  VALUES (r.donation_id, 'RELEASE_MANUAL_RECONCILIATION', r.amount_cents, jsonb_build_object('release_id', r.id, 'reason', LEFT(_reason, 300)));
  RETURN jsonb_build_object('flagged', true);
END $$;

REVOKE ALL ON FUNCTION public.donation_release_reserve(uuid, text, text, integer, integer, text, text, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.donation_release_submit_guard(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.donation_release_flag_manual(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.donation_release_reserve(uuid, text, text, integer, integer, text, text, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.donation_release_submit_guard(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.donation_release_flag_manual(uuid, text) TO service_role;