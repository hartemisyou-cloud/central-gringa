-- Additive: persisted HHF origin marker on orders. Drives the neutral
-- post-payment page for foundation-originated purchases; default false keeps
-- every existing order on the current bookstore receipt experience.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS origin_hhf boolean NOT NULL DEFAULT false;
