CREATE TABLE public.donation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  recipient_name text NOT NULL DEFAULT 'Hope Human Foundation',
  recipient_country text NOT NULL DEFAULT 'US',
  use_of_funds text NOT NULL DEFAULT '',
  platform_country text,
  stripe_fundraising_approved boolean NOT NULL DEFAULT false,
  connect_approved boolean NOT NULL DEFAULT false,
  usd_settlement_eligible boolean NOT NULL DEFAULT false,
  adaptive_pricing_eligible boolean NOT NULL DEFAULT false,
  adaptive_pricing_enabled boolean NOT NULL DEFAULT false,
  allowed_recipient_countries text[] NOT NULL DEFAULT '{}',
  recipient_service_agreement_allowed boolean NOT NULL DEFAULT false,
  fee_coverage_policy text,
  dashboard_responsibility text,
  negative_balance_liability text,
  donations_enabled boolean NOT NULL DEFAULT false,
  releases_enabled boolean NOT NULL DEFAULT false,
  ngo_fee_funding_cents integer NOT NULL DEFAULT 0 CHECK (ngo_fee_funding_cents >= 0),
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.donation_beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  country text NOT NULL,
  stripe_account_id text,
  onboarding_status text NOT NULL DEFAULT 'NOT_STARTED',
  transfers_capability text NOT NULL DEFAULT 'inactive',
  service_agreement text,
  review_status text NOT NULL DEFAULT 'UNREVIEWED',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.donation_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  review_status text NOT NULL DEFAULT 'UNREVIEWED',
  active boolean NOT NULL DEFAULT false,
  ends_at timestamptz,
  release_mode text NOT NULL DEFAULT 'MANUAL',
  beneficiary_id uuid REFERENCES public.donation_beneficiaries(id),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, slug)
);

CREATE TABLE public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  campaign_id uuid NOT NULL REFERENCES public.donation_campaigns(id),
  donation_number text NOT NULL UNIQUE,
  public_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'USD',
  donor_first_name text,
  donor_last_name text,
  donor_email text,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  integration_id uuid REFERENCES public.stripe_integrations(id),
  livemode boolean NOT NULL DEFAULT false,
  checkout_session_id text UNIQUE,
  checkout_url text,
  checkout_expires_at timestamptz,
  payment_intent_id text,
  charge_id text,
  presentment_amount integer,
  presentment_currency text,
  refunded_cents integer NOT NULL DEFAULT 0,
  disputed boolean NOT NULL DEFAULT false,
  beneficiary_id uuid REFERENCES public.donation_beneficiaries(id),
  beneficiary_snapshot jsonb,
  paid_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, idempotency_key)
);
CREATE INDEX donations_payment_intent_idx ON public.donations(payment_intent_id);
CREATE INDEX donations_campaign_idx ON public.donations(campaign_id, status);

CREATE TABLE public.donation_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL REFERENCES public.donations(id),
  entry_type text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  stripe_object_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX donation_ledger_donation_idx ON public.donation_ledger(donation_id);

CREATE TABLE public.donation_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL UNIQUE REFERENCES public.donations(id),
  idempotency_key text NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  fee_coverage_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  destination_account_id text NOT NULL,
  source_charge_id text NOT NULL,
  preview_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  transfer_id text,
  confirmed_by text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.donation_settings, public.donation_beneficiaries, public.donation_campaigns, public.donations, public.donation_ledger, public.donation_releases TO service_role;
ALTER TABLE public.donation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_releases ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER donation_settings_updated BEFORE UPDATE ON public.donation_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER donation_beneficiaries_updated BEFORE UPDATE ON public.donation_beneficiaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER donation_campaigns_updated BEFORE UPDATE ON public.donation_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER donations_updated BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER donation_releases_updated BEFORE UPDATE ON public.donation_releases FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
  RETURN NEW;
END $$;
CREATE TRIGGER donations_protect_snapshot BEFORE UPDATE ON public.donations FOR EACH ROW EXECUTE FUNCTION public.protect_donation_snapshot();