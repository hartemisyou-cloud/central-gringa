-- Central: portable schema derived from the official Lovable Cloud backup.
-- Source database: PostgreSQL17.11; export command: pg_restore --schema-only --schema=public --no-owner --no-privileges.
-- Adaptations are exhaustively recorded in schema-adaptations.json and README.md.
-- No rows, credentials, passwords or Storage objects are included here.
-- This file is applied by the migration connection, never the runtime connection.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 18.6 (Debian 18.6-3)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: api_key_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.api_key_status AS ENUM (
    'ACTIVE',
    'REVOKED'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'ADMIN',
    'FINANCE',
    'SUPPORT'
);


--
-- Name: integration_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.integration_status AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'ERROR'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_status AS ENUM (
    'PENDING_PAYMENT',
    'PAYMENT_PROCESSING',
    'PAID',
    'PAYMENT_FAILED',
    'CANCELLED',
    'REFUNDED',
    'PARTIALLY_REFUNDED'
);


--
-- Name: payment_environment; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_environment AS ENUM (
    'test',
    'live'
);


--
-- Name: payment_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_provider AS ENUM (
    'STRIPE'
);


--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_status AS ENUM (
    'REQUIRES_PAYMENT',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'REFUNDED',
    'PARTIALLY_REFUNDED'
);


--
-- Name: refund_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.refund_status AS ENUM (
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);


--
-- Name: store_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.store_status AS ENUM (
    'ACTIVE',
    'INACTIVE'
);


--
-- Name: webhook_processing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.webhook_processing_status AS ENUM (
    'RECEIVED',
    'PROCESSED',
    'FAILED',
    'IGNORED'
);


--
-- Name: bump_rate_limit(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_rate_limit(_bucket text, _window_seconds integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _win TIMESTAMPTZ; _count INTEGER;
BEGIN
  _win := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);
  INSERT INTO public.rate_limit_counters (bucket, window_start, count)
  VALUES (_bucket, _win, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET count = public.rate_limit_counters.count + 1
  RETURNING count INTO _count;
  DELETE FROM public.rate_limit_counters WHERE window_start < now() - INTERVAL '1 day';
  RETURN _count;
END; $$;


--
-- Name: commit_order_stock(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.commit_order_stock(_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.products p
     SET stock = GREATEST(p.stock - oi.quantity, 0),
         reserved_stock = GREATEST(p.reserved_stock - oi.quantity, 0)
    FROM public.order_items oi
   WHERE oi.order_id = _order_id AND oi.product_id = p.id;
  UPDATE public.orders SET stock_committed = true, stock_reserved = false WHERE id = _order_id;
END; $$;


--
-- Name: donation_apply_event(uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donation_apply_event(_donation_id uuid, _signal text, _event_id text, _object_id text, _facts jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: donation_release_flag_manual(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donation_release_flag_manual(_release_id uuid, _reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: donation_release_mark(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donation_release_mark(_release_id uuid, _outcome text, _transfer_id text, _error text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: donation_release_reserve(uuid, text, text, integer, integer, text, text, bigint, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donation_release_reserve(_donation_id uuid, _preview_hash text, _confirmed_by text, _amount integer, _fee integer, _dest text, _source text, _available_usd bigint, _fee_budget integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: donation_release_submit_guard(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donation_release_submit_guard(_release_id uuid, _window_seconds integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;


--
-- Name: is_staff(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id
       AND role IN ('ADMIN'::app_role, 'FINANCE'::app_role, 'SUPPORT'::app_role)
  );
$$;


--
-- Name: protect_donation_checkout_window(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_donation_checkout_window() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.checkout_first_attempt_at IS NOT NULL AND NEW.checkout_first_attempt_at IS DISTINCT FROM OLD.checkout_first_attempt_at THEN
    RAISE EXCEPTION 'checkout attempt window start is immutable';
  END IF;
  IF OLD.checkout_manual_review AND NOT NEW.checkout_manual_review THEN
    RAISE EXCEPTION 'checkout manual review flag is sticky';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: protect_donation_release(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_donation_release() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: protect_donation_release_window(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_donation_release_window() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: protect_donation_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_donation_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: release_order_stock(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_order_stock(_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.products p SET reserved_stock = GREATEST(p.reserved_stock - oi.quantity, 0)
    FROM public.order_items oi
   WHERE oi.order_id = _order_id AND oi.product_id = p.id;
  UPDATE public.orders SET stock_reserved = false WHERE id = _order_id;
END; $$;


--
-- Name: reserve_stock(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_stock(_product_id uuid, _qty integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _ok INTEGER;
BEGIN
  UPDATE public.products
     SET reserved_stock = reserved_stock + _qty
   WHERE id = _product_id AND active = true AND (stock - reserved_stock) >= _qty;
  GET DIAGNOSTICS _ok = ROW_COUNT;
  RETURN _ok = 1;
END; $$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    store_id uuid NOT NULL,
    recipient_name text NOT NULL,
    phone text,
    postal_code text NOT NULL,
    street text NOT NULL,
    number text NOT NULL,
    complement text,
    district text NOT NULL,
    city text NOT NULL,
    state text NOT NULL,
    country text DEFAULT 'BR'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'client'::text NOT NULL,
    store_id uuid,
    integration_id uuid,
    order_id uuid,
    public_token text,
    payment_intent_id text,
    payment_method text,
    currency text,
    amount_cents integer,
    country text,
    browser text,
    device_type text,
    operating_system text,
    referrer text,
    checkout_session_id text,
    anonymous_session_id text,
    decline_code text,
    decline_category text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cart_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: carts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.carts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checkout_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkout_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    anonymous_session_id text NOT NULL,
    checkout_session_id text NOT NULL,
    store_id uuid,
    integration_id uuid,
    order_id uuid,
    public_token text,
    payment_intent_id text,
    currency text,
    amount_cents integer,
    country text,
    browser text,
    device_type text,
    operating_system text,
    referrer text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    status text DEFAULT 'VIEWED'::text NOT NULL,
    viewed_at timestamp with time zone,
    started_at timestamp with time zone,
    attempted_at timestamp with time zone,
    succeeded_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    email text NOT NULL,
    first_name text,
    last_name text,
    phone text,
    document text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: donation_beneficiaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_beneficiaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    display_name text NOT NULL,
    country text NOT NULL,
    stripe_account_id text,
    onboarding_status text DEFAULT 'NOT_STARTED'::text NOT NULL,
    transfers_capability text DEFAULT 'inactive'::text NOT NULL,
    service_agreement text,
    review_status text DEFAULT 'UNREVIEWED'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_verified_at timestamp with time zone,
    provider_country text,
    provider_transfers_status text
);


--
-- Name: COLUMN donation_beneficiaries.onboarding_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.donation_beneficiaries.onboarding_status IS 'DEPRECATED: operator-typed; readiness comes from a live provider check';


--
-- Name: COLUMN donation_beneficiaries.transfers_capability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.donation_beneficiaries.transfers_capability IS 'DEPRECATED: operator-typed; readiness comes from a live provider check';


--
-- Name: donation_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    review_status text DEFAULT 'UNREVIEWED'::text NOT NULL,
    active boolean DEFAULT false NOT NULL,
    ends_at timestamp with time zone,
    release_mode text DEFAULT 'MANUAL'::text NOT NULL,
    beneficiary_id uuid,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    manifest_version text,
    manifest_source text
);


--
-- Name: donation_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donation_id uuid NOT NULL,
    entry_type text NOT NULL,
    amount_cents integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    stripe_object_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_event_id text
);


--
-- Name: donation_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    donation_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    amount_cents integer NOT NULL,
    fee_coverage_cents integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    destination_account_id text NOT NULL,
    source_charge_id text NOT NULL,
    preview_hash text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    transfer_id text,
    confirmed_by text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    integration_id uuid,
    livemode boolean,
    platform_account_id text,
    attempt integer DEFAULT 1 NOT NULL,
    adverse_during_release boolean DEFAULT false NOT NULL,
    submitted_at timestamp with time zone,
    resolved_at timestamp with time zone,
    manual_reconciliation_required boolean DEFAULT false NOT NULL,
    manual_reconciliation_reason text,
    CONSTRAINT donation_releases_amount_cents_check CHECK ((amount_cents > 0))
);


--
-- Name: donation_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donation_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    recipient_name text DEFAULT 'Hope Human Foundation'::text NOT NULL,
    recipient_country text DEFAULT 'US'::text NOT NULL,
    use_of_funds text DEFAULT ''::text NOT NULL,
    platform_country text,
    stripe_fundraising_approved boolean DEFAULT false NOT NULL,
    connect_approved boolean DEFAULT false NOT NULL,
    usd_settlement_eligible boolean DEFAULT false NOT NULL,
    adaptive_pricing_eligible boolean DEFAULT false NOT NULL,
    adaptive_pricing_enabled boolean DEFAULT false NOT NULL,
    allowed_recipient_countries text[] DEFAULT '{}'::text[] NOT NULL,
    recipient_service_agreement_allowed boolean DEFAULT false NOT NULL,
    fee_coverage_policy text,
    dashboard_responsibility text,
    negative_balance_liability text,
    donations_enabled boolean DEFAULT false NOT NULL,
    releases_enabled boolean DEFAULT false NOT NULL,
    ngo_fee_funding_cents integer DEFAULT 0 NOT NULL,
    confirmed_by text,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    manual_payout_schedule_confirmed boolean DEFAULT false NOT NULL,
    max_hold_days integer,
    stripe_granted_countries text[] DEFAULT '{}'::text[] NOT NULL,
    legal_account_name_confirmed boolean DEFAULT false NOT NULL,
    onboarding_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT donation_settings_max_hold_days_check CHECK (((max_hold_days IS NULL) OR (max_hold_days > 0))),
    CONSTRAINT donation_settings_ngo_fee_funding_cents_check CHECK ((ngo_fee_funding_cents >= 0))
);


--
-- Name: COLUMN donation_settings.recipient_service_agreement_allowed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.donation_settings.recipient_service_agreement_allowed IS 'DEPRECATED: cross-border payouts are not allowed under the recipient service agreement';


--
-- Name: donations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    donation_number text NOT NULL,
    public_token text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    donor_first_name text,
    donor_last_name text,
    donor_email text,
    attribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint text NOT NULL,
    integration_id uuid,
    livemode boolean DEFAULT false NOT NULL,
    checkout_session_id text,
    checkout_url text,
    checkout_expires_at timestamp with time zone,
    payment_intent_id text,
    charge_id text,
    presentment_amount integer,
    presentment_currency text,
    refunded_cents integer DEFAULT 0 NOT NULL,
    disputed boolean DEFAULT false NOT NULL,
    beneficiary_id uuid,
    beneficiary_snapshot jsonb,
    paid_at timestamp with time zone,
    released_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    session_request jsonb,
    integration_identifier text,
    payment_confirmed boolean DEFAULT false NOT NULL,
    platform_account_id text,
    receipt_snapshot jsonb,
    last_payment_error text,
    checkout_first_attempt_at timestamp with time zone,
    checkout_manual_review boolean DEFAULT false NOT NULL,
    CONSTRAINT donations_amount_cents_check CHECK ((amount_cents > 0))
);


--
-- Name: meta_conversion_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_conversion_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid,
    event_name text NOT NULL,
    event_id text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    meta_event_id text,
    http_status integer,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meta_tracking_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_tracking_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    pixel_id text,
    access_token_ciphertext text,
    access_token_last4 text,
    test_event_code text,
    enabled boolean DEFAULT false NOT NULL,
    last_success_at timestamp with time zone,
    last_error text,
    last_error_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_attribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_attribution (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_content text,
    utm_term text,
    gclid text,
    fbclid text,
    ttclid text,
    msclkid text,
    gbraid text,
    wbraid text,
    fbp text,
    fbc text,
    referrer text,
    landing_page text,
    click_id text,
    checkout_session_id text,
    anonymous_session_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_ip text,
    client_user_agent text,
    event_source_url text
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    sku text NOT NULL,
    unit_price_cents integer NOT NULL,
    quantity integer NOT NULL,
    total_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    order_number text NOT NULL,
    customer_id uuid,
    shipping_address_id uuid,
    status public.order_status DEFAULT 'PENDING_PAYMENT'::public.order_status NOT NULL,
    environment public.payment_environment NOT NULL,
    currency text DEFAULT 'BRL'::text NOT NULL,
    subtotal_cents integer DEFAULT 0 NOT NULL,
    shipping_cents integer DEFAULT 0 NOT NULL,
    discount_cents integer DEFAULT 0 NOT NULL,
    total_cents integer DEFAULT 0 NOT NULL,
    shipping_method text,
    stock_reserved boolean DEFAULT false NOT NULL,
    stock_committed boolean DEFAULT false NOT NULL,
    public_token text NOT NULL,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    order_id uuid,
    type text NOT NULL,
    message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid NOT NULL,
    provider public.payment_provider DEFAULT 'STRIPE'::public.payment_provider NOT NULL,
    provider_payment_id text,
    integration_id uuid,
    amount_cents integer NOT NULL,
    refunded_cents integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'BRL'::text NOT NULL,
    status public.payment_status DEFAULT 'REQUIRES_PAYMENT'::public.payment_status NOT NULL,
    environment public.payment_environment NOT NULL,
    payment_method text,
    attempt integer DEFAULT 1 NOT NULL,
    idempotency_key text NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: presence_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presence_sessions (
    session_id text NOT NULL,
    store_id uuid,
    state text DEFAULT 'ACTIVE'::text NOT NULL,
    page text,
    user_agent text,
    is_bot boolean DEFAULT false NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cart_opened_at timestamp with time zone,
    cart_closed_at timestamp with time zone,
    checkout_viewed_at timestamp with time zone,
    CONSTRAINT presence_sessions_state_check CHECK ((state = ANY (ARRAY['ACTIVE'::text, 'CART'::text, 'CHECKOUT'::text, 'PAID'::text, 'ENDED'::text])))
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    name text NOT NULL,
    sku text NOT NULL,
    price_cents integer,
    stock integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_variants_price_cents_check CHECK ((price_cents >= 0)),
    CONSTRAINT product_variants_stock_check CHECK ((stock >= 0))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    sku text NOT NULL,
    price_cents integer NOT NULL,
    currency text DEFAULT 'BRL'::text NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    reserved_stock integer DEFAULT 0 NOT NULL,
    weight_grams integer DEFAULT 500 NOT NULL,
    image_url text,
    category text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT products_price_cents_check CHECK ((price_cents >= 0)),
    CONSTRAINT products_reserved_stock_check CHECK ((reserved_stock >= 0)),
    CONSTRAINT products_stock_check CHECK ((stock >= 0))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    full_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_counters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 1 NOT NULL
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    store_id uuid NOT NULL,
    provider_refund_id text,
    amount_cents integer NOT NULL,
    reason text,
    status public.refund_status DEFAULT 'PENDING'::public.refund_status NOT NULL,
    requested_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refunds_amount_cents_check CHECK ((amount_cents > 0))
);


--
-- Name: store_api_key_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_api_key_scopes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_key_id uuid NOT NULL,
    store_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: store_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    label text DEFAULT 'default'::text NOT NULL,
    key_id text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    status public.api_key_status DEFAULT 'ACTIVE'::public.api_key_status NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    encrypted_key text
);


--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    domain text,
    status public.store_status DEFAULT 'ACTIVE'::public.store_status NOT NULL,
    environment public.payment_environment DEFAULT 'test'::public.payment_environment NOT NULL,
    stripe_integration_id uuid,
    allowed_origins text[] DEFAULT '{}'::text[] NOT NULL,
    currency text DEFAULT 'BRL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_checkout_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_checkout_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid NOT NULL,
    integration_id uuid,
    session_id text NOT NULL,
    client_secret text,
    status text DEFAULT 'open'::text NOT NULL,
    payment_intent_id text,
    base_amount_cents integer NOT NULL,
    base_currency text NOT NULL,
    amount_total integer,
    currency text,
    presented_amount_total integer,
    presented_currency text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stripe_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    environment public.payment_environment NOT NULL,
    publishable_key text NOT NULL,
    secret_key_ciphertext text,
    secret_key_last4 text,
    webhook_secret_ciphertext text,
    stripe_account_id text,
    status public.integration_status DEFAULT 'INACTIVE'::public.integration_status NOT NULL,
    connection_error text,
    last_validated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_method_configuration_id text
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: utmify_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.utmify_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    order_id uuid,
    order_number text,
    event_status text DEFAULT 'paid'::text NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    http_status integer,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: utmify_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.utmify_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id uuid NOT NULL,
    webhook_id text,
    api_token_ciphertext text,
    api_token_last4 text,
    enabled boolean DEFAULT false NOT NULL,
    is_test boolean DEFAULT false NOT NULL,
    last_success_at timestamp with time zone,
    last_order_number text,
    last_error text,
    last_error_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider public.payment_provider DEFAULT 'STRIPE'::public.payment_provider NOT NULL,
    stripe_event_id text NOT NULL,
    event_type text NOT NULL,
    livemode boolean DEFAULT false NOT NULL,
    integration_id uuid,
    processed boolean DEFAULT false NOT NULL,
    processing_status public.webhook_processing_status DEFAULT 'RECEIVED'::public.webhook_processing_status NOT NULL,
    error_message text,
    payload_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone
);


--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_event_id_key UNIQUE (event_id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_cart_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_product_id_key UNIQUE (cart_id, product_id);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: carts carts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_pkey PRIMARY KEY (id);


--
-- Name: checkout_sessions checkout_sessions_checkout_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_sessions
    ADD CONSTRAINT checkout_sessions_checkout_session_id_key UNIQUE (checkout_session_id);


--
-- Name: checkout_sessions checkout_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_sessions
    ADD CONSTRAINT checkout_sessions_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_store_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_store_id_email_key UNIQUE (store_id, email);


--
-- Name: donation_beneficiaries donation_beneficiaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_beneficiaries
    ADD CONSTRAINT donation_beneficiaries_pkey PRIMARY KEY (id);


--
-- Name: donation_campaigns donation_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_campaigns
    ADD CONSTRAINT donation_campaigns_pkey PRIMARY KEY (id);


--
-- Name: donation_campaigns donation_campaigns_store_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_campaigns
    ADD CONSTRAINT donation_campaigns_store_id_slug_key UNIQUE (store_id, slug);


--
-- Name: donation_ledger donation_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_ledger
    ADD CONSTRAINT donation_ledger_pkey PRIMARY KEY (id);


--
-- Name: donation_releases donation_releases_donation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_releases
    ADD CONSTRAINT donation_releases_donation_id_key UNIQUE (donation_id);


--
-- Name: donation_releases donation_releases_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_releases
    ADD CONSTRAINT donation_releases_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: donation_releases donation_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_releases
    ADD CONSTRAINT donation_releases_pkey PRIMARY KEY (id);


--
-- Name: donation_settings donation_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_settings
    ADD CONSTRAINT donation_settings_pkey PRIMARY KEY (id);


--
-- Name: donation_settings donation_settings_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_settings
    ADD CONSTRAINT donation_settings_store_id_key UNIQUE (store_id);


--
-- Name: donations donations_checkout_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_checkout_session_id_key UNIQUE (checkout_session_id);


--
-- Name: donations donations_donation_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_donation_number_key UNIQUE (donation_number);


--
-- Name: donations donations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_pkey PRIMARY KEY (id);


--
-- Name: donations donations_public_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_public_token_key UNIQUE (public_token);


--
-- Name: donations donations_store_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_store_id_idempotency_key_key UNIQUE (store_id, idempotency_key);


--
-- Name: meta_conversion_events meta_conversion_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_conversion_events
    ADD CONSTRAINT meta_conversion_events_pkey PRIMARY KEY (id);


--
-- Name: meta_conversion_events meta_conversion_events_store_id_event_id_event_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_conversion_events
    ADD CONSTRAINT meta_conversion_events_store_id_event_id_event_name_key UNIQUE (store_id, event_id, event_name);


--
-- Name: meta_tracking_settings meta_tracking_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_tracking_settings
    ADD CONSTRAINT meta_tracking_settings_pkey PRIMARY KEY (id);


--
-- Name: meta_tracking_settings meta_tracking_settings_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_tracking_settings
    ADD CONSTRAINT meta_tracking_settings_store_id_key UNIQUE (store_id);


--
-- Name: order_attribution order_attribution_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_attribution
    ADD CONSTRAINT order_attribution_order_id_key UNIQUE (order_id);


--
-- Name: order_attribution order_attribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_attribution
    ADD CONSTRAINT order_attribution_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: orders orders_public_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_public_token_key UNIQUE (public_token);


--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- Name: payments payments_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_provider_provider_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_provider_provider_payment_id_key UNIQUE (provider, provider_payment_id);


--
-- Name: presence_sessions presence_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presence_sessions
    ADD CONSTRAINT presence_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_product_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_sku_key UNIQUE (product_id, sku);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_store_id_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_store_id_sku_key UNIQUE (store_id, sku);


--
-- Name: products products_store_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_store_id_slug_key UNIQUE (store_id, slug);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_counters rate_limit_counters_bucket_window_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_counters
    ADD CONSTRAINT rate_limit_counters_bucket_window_start_key UNIQUE (bucket, window_start);


--
-- Name: rate_limit_counters rate_limit_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_counters
    ADD CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_provider_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_provider_refund_id_key UNIQUE (provider_refund_id);


--
-- Name: store_api_key_scopes store_api_key_scopes_api_key_id_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_api_key_scopes
    ADD CONSTRAINT store_api_key_scopes_api_key_id_store_id_key UNIQUE (api_key_id, store_id);


--
-- Name: store_api_key_scopes store_api_key_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_api_key_scopes
    ADD CONSTRAINT store_api_key_scopes_pkey PRIMARY KEY (id);


--
-- Name: store_api_keys store_api_keys_key_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_api_keys
    ADD CONSTRAINT store_api_keys_key_id_key UNIQUE (key_id);


--
-- Name: store_api_keys store_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_api_keys
    ADD CONSTRAINT store_api_keys_pkey PRIMARY KEY (id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: stores stores_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_slug_key UNIQUE (slug);


--
-- Name: stripe_checkout_sessions stripe_checkout_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_checkout_sessions
    ADD CONSTRAINT stripe_checkout_sessions_pkey PRIMARY KEY (id);


--
-- Name: stripe_checkout_sessions stripe_checkout_sessions_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_checkout_sessions
    ADD CONSTRAINT stripe_checkout_sessions_session_id_key UNIQUE (session_id);


--
-- Name: stripe_integrations stripe_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_integrations
    ADD CONSTRAINT stripe_integrations_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: utmify_events utmify_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utmify_events
    ADD CONSTRAINT utmify_events_pkey PRIMARY KEY (id);


--
-- Name: utmify_events utmify_events_store_id_order_id_event_status_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utmify_events
    ADD CONSTRAINT utmify_events_store_id_order_id_event_status_key UNIQUE (store_id, order_id, event_status);


--
-- Name: utmify_settings utmify_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utmify_settings
    ADD CONSTRAINT utmify_settings_pkey PRIMARY KEY (id);


--
-- Name: utmify_settings utmify_settings_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utmify_settings
    ADD CONSTRAINT utmify_settings_store_id_key UNIQUE (store_id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_provider_stripe_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_provider_stripe_event_id_key UNIQUE (provider, stripe_event_id);


--
-- Name: donation_ledger_donation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donation_ledger_donation_idx ON public.donation_ledger USING btree (donation_id);


--
-- Name: donation_ledger_event_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX donation_ledger_event_uniq ON public.donation_ledger USING btree (donation_id, stripe_event_id, entry_type) WHERE (stripe_event_id IS NOT NULL);


--
-- Name: donations_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_campaign_idx ON public.donations USING btree (campaign_id, status);


--
-- Name: donations_payment_intent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donations_payment_intent_idx ON public.donations USING btree (payment_intent_id);


--
-- Name: idx_analytics_events_integration; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_integration ON public.analytics_events USING btree (integration_id);


--
-- Name: idx_analytics_events_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_method ON public.analytics_events USING btree (payment_method);


--
-- Name: idx_analytics_events_pi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_pi ON public.analytics_events USING btree (payment_intent_id);


--
-- Name: idx_analytics_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_session ON public.analytics_events USING btree (checkout_session_id);


--
-- Name: idx_analytics_events_store_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_store_time ON public.analytics_events USING btree (store_id, occurred_at DESC);


--
-- Name: idx_analytics_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_analytics_events_type_time ON public.analytics_events USING btree (event_type, occurred_at DESC);


--
-- Name: idx_checkout_sessions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkout_sessions_order ON public.checkout_sessions USING btree (order_id);


--
-- Name: idx_checkout_sessions_store_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkout_sessions_store_time ON public.checkout_sessions USING btree (store_id, first_seen_at DESC);


--
-- Name: idx_meta_conversion_events_store_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meta_conversion_events_store_status ON public.meta_conversion_events USING btree (store_id, status, created_at DESC);


--
-- Name: idx_order_attribution_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_attribution_order_id ON public.order_attribution USING btree (order_id);


--
-- Name: idx_orders_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_store ON public.orders USING btree (store_id, created_at DESC);


--
-- Name: idx_payments_active_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payments_active_order ON public.payments USING btree (order_id) WHERE (status = ANY (ARRAY['REQUIRES_PAYMENT'::public.payment_status, 'PROCESSING'::public.payment_status]));


--
-- Name: meta_conversion_events_store_order_event_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX meta_conversion_events_store_order_event_key ON public.meta_conversion_events USING btree (store_id, order_id, event_name) WHERE (order_id IS NOT NULL);


--
-- Name: presence_sessions_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX presence_sessions_last_seen_idx ON public.presence_sessions USING btree (last_seen_at DESC);


--
-- Name: presence_sessions_store_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX presence_sessions_store_state_idx ON public.presence_sessions USING btree (store_id, state, last_seen_at DESC);


--
-- Name: stripe_checkout_sessions_open_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX stripe_checkout_sessions_open_order_idx ON public.stripe_checkout_sessions USING btree (order_id) WHERE (status = 'open'::text);


--
-- Name: stripe_checkout_sessions_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_checkout_sessions_order_idx ON public.stripe_checkout_sessions USING btree (order_id);


--
-- Name: stripe_checkout_sessions_pi_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_checkout_sessions_pi_idx ON public.stripe_checkout_sessions USING btree (payment_intent_id);


--
-- Name: donation_beneficiaries donation_beneficiaries_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donation_beneficiaries_updated BEFORE UPDATE ON public.donation_beneficiaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: donation_campaigns donation_campaigns_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donation_campaigns_updated BEFORE UPDATE ON public.donation_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: donation_releases donation_releases_protect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donation_releases_protect BEFORE UPDATE ON public.donation_releases FOR EACH ROW EXECUTE FUNCTION public.protect_donation_release();


--
-- Name: donation_releases donation_releases_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donation_releases_updated BEFORE UPDATE ON public.donation_releases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: donation_releases donation_releases_window; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donation_releases_window BEFORE UPDATE ON public.donation_releases FOR EACH ROW EXECUTE FUNCTION public.protect_donation_release_window();


--
-- Name: donation_settings donation_settings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donation_settings_updated BEFORE UPDATE ON public.donation_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: donations donations_checkout_window; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donations_checkout_window BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.protect_donation_checkout_window();


--
-- Name: donations donations_protect_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donations_protect_snapshot BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.protect_donation_snapshot();


--
-- Name: donations donations_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER donations_updated BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: meta_conversion_events trg_meta_conversion_events_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_meta_conversion_events_updated BEFORE UPDATE ON public.meta_conversion_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: meta_tracking_settings trg_meta_tracking_settings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_meta_tracking_settings_updated BEFORE UPDATE ON public.meta_tracking_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_attribution trg_order_attribution_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_order_attribution_updated BEFORE UPDATE ON public.order_attribution FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders trg_orders_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: payments trg_payments_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: presence_sessions trg_presence_sessions_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_presence_sessions_updated BEFORE UPDATE ON public.presence_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products trg_products_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: stores trg_stores_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stores_updated BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: stripe_checkout_sessions trg_stripe_checkout_sessions_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stripe_checkout_sessions_updated BEFORE UPDATE ON public.stripe_checkout_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: stripe_integrations trg_stripe_integrations_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stripe_integrations_updated BEFORE UPDATE ON public.stripe_integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: utmify_events trg_utmify_events_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_utmify_events_updated BEFORE UPDATE ON public.utmify_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: utmify_settings trg_utmify_settings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_utmify_settings_updated BEFORE UPDATE ON public.utmify_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: addresses addresses_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: addresses addresses_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: analytics_events analytics_events_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.stripe_integrations(id);


--
-- Name: analytics_events analytics_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: analytics_events analytics_events_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: cart_items cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.carts(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: carts carts_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.carts
    ADD CONSTRAINT carts_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: checkout_sessions checkout_sessions_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_sessions
    ADD CONSTRAINT checkout_sessions_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.stripe_integrations(id);


--
-- Name: checkout_sessions checkout_sessions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_sessions
    ADD CONSTRAINT checkout_sessions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: checkout_sessions checkout_sessions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkout_sessions
    ADD CONSTRAINT checkout_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: customers customers_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: donation_beneficiaries donation_beneficiaries_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_beneficiaries
    ADD CONSTRAINT donation_beneficiaries_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: donation_campaigns donation_campaigns_beneficiary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_campaigns
    ADD CONSTRAINT donation_campaigns_beneficiary_id_fkey FOREIGN KEY (beneficiary_id) REFERENCES public.donation_beneficiaries(id);


--
-- Name: donation_campaigns donation_campaigns_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_campaigns
    ADD CONSTRAINT donation_campaigns_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: donation_ledger donation_ledger_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_ledger
    ADD CONSTRAINT donation_ledger_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- Name: donation_releases donation_releases_donation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_releases
    ADD CONSTRAINT donation_releases_donation_id_fkey FOREIGN KEY (donation_id) REFERENCES public.donations(id);


--
-- Name: donation_releases donation_releases_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_releases
    ADD CONSTRAINT donation_releases_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.stripe_integrations(id);


--
-- Name: donation_settings donation_settings_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donation_settings
    ADD CONSTRAINT donation_settings_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: donations donations_beneficiary_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_beneficiary_id_fkey FOREIGN KEY (beneficiary_id) REFERENCES public.donation_beneficiaries(id);


--
-- Name: donations donations_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.donation_campaigns(id);


--
-- Name: donations donations_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.stripe_integrations(id);


--
-- Name: donations donations_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donations
    ADD CONSTRAINT donations_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id);


--
-- Name: meta_conversion_events meta_conversion_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_conversion_events
    ADD CONSTRAINT meta_conversion_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: meta_conversion_events meta_conversion_events_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_conversion_events
    ADD CONSTRAINT meta_conversion_events_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: meta_tracking_settings meta_tracking_settings_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_tracking_settings
    ADD CONSTRAINT meta_tracking_settings_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: order_attribution order_attribution_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_attribution
    ADD CONSTRAINT order_attribution_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: orders orders_shipping_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shipping_address_id_fkey FOREIGN KEY (shipping_address_id) REFERENCES public.addresses(id) ON DELETE SET NULL;


--
-- Name: orders orders_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE RESTRICT;


--
-- Name: payment_events payment_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: payment_events payment_events_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;


--
-- Name: payments payments_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.stripe_integrations(id) ON DELETE SET NULL;


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: payments payments_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE RESTRICT;


--
-- Name: presence_sessions presence_sessions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presence_sessions
    ADD CONSTRAINT presence_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE SET NULL;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

-- Removed profiles_id_fkey: the source auth.users snapshot is empty; legacy rows remain preserved.


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;


--
-- Name: refunds refunds_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE RESTRICT;


--
-- Name: store_api_key_scopes store_api_key_scopes_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_api_key_scopes
    ADD CONSTRAINT store_api_key_scopes_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.store_api_keys(id) ON DELETE CASCADE;


--
-- Name: store_api_key_scopes store_api_key_scopes_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_api_key_scopes
    ADD CONSTRAINT store_api_key_scopes_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_api_keys store_api_keys_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_api_keys
    ADD CONSTRAINT store_api_keys_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: stores stores_stripe_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_stripe_integration_id_fkey FOREIGN KEY (stripe_integration_id) REFERENCES public.stripe_integrations(id) ON DELETE SET NULL;


--
-- Name: stripe_checkout_sessions stripe_checkout_sessions_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_checkout_sessions
    ADD CONSTRAINT stripe_checkout_sessions_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.stripe_integrations(id);


--
-- Name: stripe_checkout_sessions stripe_checkout_sessions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_checkout_sessions
    ADD CONSTRAINT stripe_checkout_sessions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: stripe_checkout_sessions stripe_checkout_sessions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_checkout_sessions
    ADD CONSTRAINT stripe_checkout_sessions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

-- Removed user_roles_user_id_fkey: the source auth.users snapshot is empty; legacy rows remain preserved.


--
-- Name: utmify_events utmify_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utmify_events
    ADD CONSTRAINT utmify_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: utmify_events utmify_events_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utmify_events
    ADD CONSTRAINT utmify_events_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: utmify_settings utmify_settings_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.utmify_settings
    ADD CONSTRAINT utmify_settings_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: webhook_events webhook_events_integration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES public.stripe_integrations(id) ON DELETE SET NULL;


--
-- Name: addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: cart_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: carts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: checkout_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: donation_beneficiaries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donation_beneficiaries ENABLE ROW LEVEL SECURITY;

--
-- Name: donation_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donation_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: donation_ledger; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donation_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: donation_releases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donation_releases ENABLE ROW LEVEL SECURITY;

--
-- Name: donation_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donation_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: donations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_conversion_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_conversion_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: meta_tracking_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_tracking_settings ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: order_attribution; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_attribution ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: presence_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.presence_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


-- Supabase client policy removed; see 003_server_acl.sql.


-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: rate_limit_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: store_api_key_scopes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_api_key_scopes ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: store_api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_api_keys ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: stores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: stripe_checkout_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: stripe_integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_integrations ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


-- Supabase client policy removed; see 003_server_acl.sql.


-- Supabase client policy removed; see 003_server_acl.sql.


-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: utmify_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.utmify_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: utmify_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.utmify_settings ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see 003_server_acl.sql.


--
-- PostgreSQL database dump complete
--



-- Restore normal execution settings after dump loading.
SET check_function_bodies = true;
SET row_security = on;
SET search_path = public, pg_catalog;
