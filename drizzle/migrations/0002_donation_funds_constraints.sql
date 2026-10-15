ALTER TABLE public.donation_settings
  ADD COLUMN manual_payout_schedule_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN max_hold_days integer CHECK (max_hold_days IS NULL OR max_hold_days > 0);
ALTER TABLE public.donation_campaigns
  ADD COLUMN manifest_version text,
  ADD COLUMN manifest_source text;