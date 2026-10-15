ALTER TABLE public.donations
  ADD COLUMN session_request jsonb,
  ADD COLUMN integration_identifier text,
  ADD COLUMN payment_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN platform_account_id text,
  ADD COLUMN receipt_snapshot jsonb,
  ADD COLUMN last_payment_error text;

ALTER TABLE public.donation_ledger ADD COLUMN stripe_event_id text;
CREATE UNIQUE INDEX donation_ledger_event_uniq ON public.donation_ledger(donation_id, stripe_event_id, entry_type) WHERE stripe_event_id IS NOT NULL;

ALTER TABLE public.donation_releases
  ADD COLUMN integration_id uuid REFERENCES public.stripe_integrations(id),
  ADD COLUMN livemode boolean,
  ADD COLUMN platform_account_id text,
  ADD COLUMN attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN adverse_during_release boolean NOT NULL DEFAULT false,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN resolved_at timestamptz;

ALTER TABLE public.donation_beneficiaries
  ADD COLUMN provider_verified_at timestamptz,
  ADD COLUMN provider_country text,
  ADD COLUMN provider_transfers_status text;
COMMENT ON COLUMN public.donation_beneficiaries.onboarding_status IS 'DEPRECATED: operator-typed; readiness comes from a live provider check';
COMMENT ON COLUMN public.donation_beneficiaries.transfers_capability IS 'DEPRECATED: operator-typed; readiness comes from a live provider check';
COMMENT ON COLUMN public.donation_settings.recipient_service_agreement_allowed IS 'DEPRECATED: cross-border payouts are not allowed under the recipient service agreement';

ALTER TABLE public.donation_settings
  ADD COLUMN stripe_granted_countries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN legal_account_name_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN onboarding_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.protect_donation_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.beneficiary_snapshot IS NOT NULL AND NEW.beneficiary_snapshot IS DISTINCT FROM OLD.beneficiary_snapshot THEN
    RAISE EXCEPTION 'beneficiary snapshot is immutable';
  END IF;
  IF OLD.beneficiary_id IS NOT NULL AND NEW.beneficiary_id IS DISTINCT FROM OLD.beneficiary_id THEN
    RAISE EXCEPTION 'beneficiary mapping is immutable';
  END IF;
  IF NEW.amount_cents <> OLD.amount_cents OR NEW.currency <> OLD.currency THEN
    RAISE EXCEPTION 'donation amount is immutable';
  END IF;
  IF OLD.session_request IS NOT NULL AND NEW.session_request IS DISTINCT FROM OLD.session_request THEN
    RAISE EXCEPTION 'session request snapshot is immutable';
  END IF;
  IF OLD.receipt_snapshot IS NOT NULL AND NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot THEN
    RAISE EXCEPTION 'receipt snapshot is immutable';
  END IF;
  IF NEW.integration_id IS DISTINCT FROM OLD.integration_id OR NEW.livemode IS DISTINCT FROM OLD.livemode
     OR (OLD.platform_account_id IS NOT NULL AND NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id) THEN
    RAISE EXCEPTION 'integration binding is immutable';
  END IF;
  IF OLD.payment_confirmed AND NOT NEW.payment_confirmed THEN RAISE EXCEPTION 'payment confirmation is sticky'; END IF;
  IF OLD.disputed AND NOT NEW.disputed THEN RAISE EXCEPTION 'dispute flag is sticky'; END IF;
  IF NEW.refunded_cents < OLD.refunded_cents THEN RAISE EXCEPTION 'refunded amount is monotonic'; END IF;
  IF OLD.checkout_session_id IS NOT NULL AND NEW.checkout_session_id IS DISTINCT FROM OLD.checkout_session_id THEN
    RAISE EXCEPTION 'checkout session link is immutable';
  END IF;
  IF OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id THEN
    RAISE EXCEPTION 'payment intent link is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.protect_donation_release()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'FAILED' AND (NEW.amount_cents <> OLD.amount_cents OR NEW.destination_account_id <> OLD.destination_account_id
     OR NEW.source_charge_id <> OLD.source_charge_id OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.fee_coverage_cents <> OLD.fee_coverage_cents) THEN
    RAISE EXCEPTION 'approved release operation is immutable';
  END IF;
  IF OLD.status = 'SUCCEEDED' AND (NEW.status <> 'SUCCEEDED' OR NEW.transfer_id IS DISTINCT FROM OLD.transfer_id) THEN
    RAISE EXCEPTION 'succeeded release is final';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER donation_releases_protect BEFORE UPDATE ON public.donation_releases FOR EACH ROW EXECUTE FUNCTION public.protect_donation_release();

-- Atomic webhook application: state, cumulative facts, ledger and in-flight release marker in one locked transaction.
CREATE OR REPLACE FUNCTION public.donation_apply_event(_donation_id uuid, _signal text, _event_id text, _object_id text, _facts jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.donations%ROWTYPE;
  r public.donation_releases%ROWTYPE;
  has_rel boolean;
  inflight boolean;
  released boolean;
  confirmed boolean;
  new_ref integer;
  new_disp boolean;
  adverse boolean;
  st text;
  pi text := NULLIF(_facts->>'payment_intent_id', '');
  ch text := NULLIF(_facts->>'charge_id', '');
BEGIN
  IF _signal NOT IN ('SESSION_PAID','SESSION_UNPAID','ASYNC_FAILED','EXPIRED','PI_FAILED','PI_CANCELED','REFUND','DISPUTE') THEN
    RAISE EXCEPTION 'unknown donation signal %', _signal;
  END IF;
  SELECT * INTO d FROM public.donations WHERE id = _donation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'donation % not found', _donation_id; END IF;
  IF _event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.donation_ledger WHERE donation_id = d.id AND stripe_event_id = _event_id) THEN
    RETURN jsonb_build_object('applied', false, 'duplicate', true, 'status', d.status);
  END IF;
  IF (pi IS NOT NULL AND d.payment_intent_id IS NOT NULL AND pi <> d.payment_intent_id)
     OR (ch IS NOT NULL AND d.charge_id IS NOT NULL AND ch <> d.charge_id) THEN
    RETURN jsonb_build_object('applied', false, 'mismatch', true, 'status', d.status);
  END IF;

  SELECT * INTO r FROM public.donation_releases WHERE donation_id = d.id FOR UPDATE;
  has_rel := FOUND;
  inflight := has_rel AND r.status IN ('RESERVED','SUBMITTED','UNKNOWN');
  released := d.status IN ('RELEASED','REVERSAL_REQUIRED') OR (has_rel AND r.status = 'SUCCEEDED');
  confirmed := d.payment_confirmed OR _signal = 'SESSION_PAID';
  new_ref := LEAST(d.amount_cents, GREATEST(d.refunded_cents, COALESCE((_facts->>'amount_refunded')::integer, 0)));
  new_disp := d.disputed OR _signal = 'DISPUTE';
  adverse := new_ref > 0 OR new_disp;

  IF released THEN
    st := CASE WHEN adverse THEN 'REVERSAL_REQUIRED' ELSE d.status END;
  ELSIF confirmed THEN
    st := CASE WHEN new_disp THEN 'DISPUTED' WHEN new_ref >= d.amount_cents THEN 'REFUNDED'
               WHEN new_ref > 0 THEN 'PARTIALLY_REFUNDED' ELSE 'PAID' END;
  ELSE
    st := d.status;
    IF _signal = 'SESSION_UNPAID' AND d.status = 'PENDING' THEN st := 'PROCESSING';
    ELSIF _signal = 'ASYNC_FAILED' AND d.status IN ('PENDING','PROCESSING') THEN st := 'FAILED';
    ELSIF _signal = 'PI_FAILED' AND d.status = 'PROCESSING' THEN st := 'FAILED';
    ELSIF _signal = 'PI_CANCELED' AND d.status IN ('PENDING','PROCESSING','FAILED') THEN st := 'CANCELLED';
    ELSIF _signal = 'EXPIRED' AND d.status IN ('PENDING','FAILED') THEN st := 'EXPIRED';
    END IF;
  END IF;

  UPDATE public.donations SET
    status = st,
    refunded_cents = new_ref,
    disputed = new_disp,
    payment_confirmed = confirmed,
    payment_intent_id = COALESCE(d.payment_intent_id, pi),
    charge_id = COALESCE(d.charge_id, ch),
    presentment_amount = COALESCE((_facts->>'presentment_amount')::integer, d.presentment_amount),
    presentment_currency = COALESCE(NULLIF(_facts->>'presentment_currency', ''), d.presentment_currency),
    paid_at = CASE WHEN _signal = 'SESSION_PAID' THEN COALESCE(d.paid_at, now()) ELSE d.paid_at END,
    last_payment_error = CASE WHEN _signal = 'PI_FAILED' THEN LEFT(COALESCE(_facts->>'error', 'payment failed'), 300) ELSE d.last_payment_error END
  WHERE id = d.id;

  IF inflight AND adverse THEN
    UPDATE public.donation_releases SET adverse_during_release = true WHERE id = r.id;
  END IF;

  INSERT INTO public.donation_ledger (donation_id, entry_type, amount_cents, currency, stripe_object_id, stripe_event_id, metadata)
  VALUES (d.id, _signal,
    CASE WHEN _signal = 'SESSION_PAID' AND NOT d.payment_confirmed THEN d.amount_cents
         WHEN _signal = 'REFUND' THEN new_ref - d.refunded_cents ELSE 0 END,
    'USD', _object_id, _event_id,
    jsonb_build_object('from', d.status, 'to', st, 'refunded_cents', new_ref, 'disputed', new_disp,
      'release_inflight', inflight, 'recovery_required', st = 'REVERSAL_REQUIRED'));

  RETURN jsonb_build_object('applied', true, 'from', d.status, 'status', st, 'refunded_cents', new_ref, 'disputed', new_disp);
END $$;

-- Reserve (or resume) a release under a platform-account scope lock.
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
  PERFORM pg_advisory_xact_lock(hashtextextended('donation-release-scope:' || COALESCE(d.integration_id::text, '-') || ':' || d.livemode::text || ':' || COALESCE(d.platform_account_id, '-'), 0));
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
  IF has_rel THEN att := r.attempt + 1; END IF;

  IF d.status <> 'PAID' OR NOT d.payment_confirmed OR d.disputed OR d.refunded_cents <> 0 THEN
    RAISE EXCEPTION 'donation is not releasable (%)', d.status;
  END IF;
  IF d.currency <> 'USD' OR _amount <> d.amount_cents THEN RAISE EXCEPTION 'release must be the full original USD amount'; END IF;
  IF _dest IS DISTINCT FROM (d.beneficiary_snapshot->>'account_id') THEN RAISE EXCEPTION 'destination differs from donation snapshot'; END IF;
  IF _source IS DISTINCT FROM d.charge_id OR _source IS NULL THEN RAISE EXCEPTION 'source charge differs from donation'; END IF;
  IF d.integration_id IS NULL OR d.platform_account_id IS NULL THEN RAISE EXCEPTION 'donation has no platform binding'; END IF;

  -- Every other still-held principal in the same platform account/environment, across stores.
  SELECT COALESCE(SUM(x.amount_cents - x.refunded_cents), 0) INTO other_held
  FROM public.donations x
  WHERE x.id <> d.id AND x.integration_id = d.integration_id AND x.livemode = d.livemode
    AND x.platform_account_id = d.platform_account_id
    AND (x.status IN ('PAID','PARTIALLY_REFUNDED','DISPUTED')
         OR EXISTS (SELECT 1 FROM public.donation_releases y WHERE y.donation_id = x.id AND y.status IN ('RESERVED','SUBMITTED','UNKNOWN')));

  SELECT COALESCE(SUM(y.fee_coverage_cents), 0) INTO fee_used
  FROM public.donation_releases y
  WHERE y.platform_account_id = d.platform_account_id AND y.livemode = d.livemode
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

CREATE OR REPLACE FUNCTION public.donation_release_mark(_release_id uuid, _outcome text, _transfer_id text, _error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.donation_releases%ROWTYPE;
  d public.donations%ROWTYPE;
  st text;
BEGIN
  SELECT * INTO r FROM public.donation_releases WHERE id = _release_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release not found'; END IF;
  SELECT * INTO d FROM public.donations WHERE id = r.donation_id FOR UPDATE;
  IF _outcome = 'SUBMITTED' THEN
    IF r.status NOT IN ('RESERVED','SUBMITTED','UNKNOWN') THEN RAISE EXCEPTION 'release not in flight (%)', r.status; END IF;
    UPDATE public.donation_releases SET status = 'SUBMITTED', submitted_at = COALESCE(submitted_at, now()) WHERE id = r.id;
    RETURN jsonb_build_object('status', 'SUBMITTED');
  ELSIF _outcome = 'SUCCEEDED' THEN
    IF _transfer_id IS NULL OR _transfer_id !~ '^tr_' THEN RAISE EXCEPTION 'transfer id required'; END IF;
    IF r.status = 'SUCCEEDED' THEN
      IF r.transfer_id <> _transfer_id THEN RAISE EXCEPTION 'different transfer already recorded'; END IF;
      RETURN jsonb_build_object('status', 'SUCCEEDED', 'donation_status', d.status, 'duplicate', true);
    END IF;
    IF r.status NOT IN ('RESERVED','SUBMITTED','UNKNOWN') THEN RAISE EXCEPTION 'release not in flight (%)', r.status; END IF;
    st := CASE WHEN r.adverse_during_release OR d.disputed OR d.refunded_cents > 0 OR d.status <> 'PAID' THEN 'REVERSAL_REQUIRED' ELSE 'RELEASED' END;
    UPDATE public.donation_releases SET status = 'SUCCEEDED', transfer_id = _transfer_id, resolved_at = now(), error = NULL WHERE id = r.id;
    UPDATE public.donations SET status = st, released_at = now() WHERE id = d.id;
    INSERT INTO public.donation_ledger (donation_id, entry_type, amount_cents, stripe_object_id, metadata) VALUES
      (d.id, 'RELEASED_TO_CONNECTED_BALANCE', r.amount_cents, _transfer_id, jsonb_build_object('release_id', r.id)),
      (d.id, 'FEE_COVERED_BY_NGO', r.fee_coverage_cents, _transfer_id, jsonb_build_object('release_id', r.id));
    IF st = 'REVERSAL_REQUIRED' THEN
      INSERT INTO public.donation_ledger (donation_id, entry_type, amount_cents, stripe_object_id, metadata)
      VALUES (d.id, 'RECOVERY_REQUIRED', r.amount_cents, _transfer_id, jsonb_build_object('reason', 'refund or dispute during or before transfer'));
    END IF;
    RETURN jsonb_build_object('status', 'SUCCEEDED', 'donation_status', st);
  ELSIF _outcome = 'UNKNOWN' THEN
    IF r.status NOT IN ('RESERVED','SUBMITTED','UNKNOWN') THEN RAISE EXCEPTION 'release not in flight (%)', r.status; END IF;
    UPDATE public.donation_releases SET status = 'UNKNOWN', error = LEFT(_error, 300) WHERE id = r.id;
    RETURN jsonb_build_object('status', 'UNKNOWN');
  ELSIF _outcome = 'FAILED' THEN
    IF r.status NOT IN ('RESERVED','SUBMITTED','UNKNOWN') THEN RAISE EXCEPTION 'release not in flight (%)', r.status; END IF;
    UPDATE public.donation_releases SET status = 'FAILED', error = LEFT(_error, 300), resolved_at = now() WHERE id = r.id;
    INSERT INTO public.donation_ledger (donation_id, entry_type, amount_cents, metadata)
    VALUES (d.id, 'RELEASE_FAILED', 0, jsonb_build_object('release_id', r.id, 'error', LEFT(_error, 300)));
    RETURN jsonb_build_object('status', 'FAILED');
  END IF;
  RAISE EXCEPTION 'unknown outcome %', _outcome;
END $$;

REVOKE ALL ON FUNCTION public.donation_apply_event(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.donation_release_reserve(uuid, text, text, integer, integer, text, text, bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.donation_release_mark(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.donation_apply_event(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.donation_release_reserve(uuid, text, text, integer, integer, text, text, bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.donation_release_mark(uuid, text, text, text) TO service_role;