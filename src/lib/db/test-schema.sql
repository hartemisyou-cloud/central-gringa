-- TEST FIXTURE ONLY. Definitions captured from source metadata on 2026-10-15.

-- Covers payment/telemetry tables; does not copy source rows, secrets, Supabase roles, Auth or RLS.

-- Foreign keys to tables outside this fixture are omitted. Do not deploy this fixture.

CREATE TYPE public."api_key_status" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TYPE public."app_role" AS ENUM ('ADMIN', 'FINANCE', 'SUPPORT');

CREATE TYPE public."integration_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

CREATE TYPE public."order_status" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'PAYMENT_FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

CREATE TYPE public."payment_environment" AS ENUM ('test', 'live');

CREATE TYPE public."payment_provider" AS ENUM ('STRIPE');

CREATE TYPE public."payment_status" AS ENUM ('REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

CREATE TYPE public."refund_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TYPE public."store_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE public."webhook_processing_status" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

CREATE TABLE public."addresses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "customer_id" uuid,
  "store_id" uuid NOT NULL,
  "recipient_name" text NOT NULL,
  "phone" text,
  "postal_code" text NOT NULL,
  "street" text NOT NULL,
  "number" text NOT NULL,
  "complement" text,
  "district" text NOT NULL,
  "city" text NOT NULL,
  "state" text NOT NULL,
  "country" text DEFAULT 'BR'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."analytics_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" text DEFAULT 'client'::text NOT NULL,
  "store_id" uuid,
  "integration_id" uuid,
  "order_id" uuid,
  "public_token" text,
  "payment_intent_id" text,
  "payment_method" text,
  "currency" text,
  "amount_cents" integer,
  "country" text,
  "browser" text,
  "device_type" text,
  "operating_system" text,
  "referrer" text,
  "checkout_session_id" text,
  "anonymous_session_id" text,
  "decline_code" text,
  "decline_category" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public."audit_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid,
  "actor_email" text,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."checkout_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "anonymous_session_id" text NOT NULL,
  "checkout_session_id" text NOT NULL,
  "store_id" uuid,
  "integration_id" uuid,
  "order_id" uuid,
  "public_token" text,
  "payment_intent_id" text,
  "currency" text,
  "amount_cents" integer,
  "country" text,
  "browser" text,
  "device_type" text,
  "operating_system" text,
  "referrer" text,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_term" text,
  "utm_content" text,
  "status" text DEFAULT 'VIEWED'::text NOT NULL,
  "viewed_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "attempted_at" timestamp with time zone,
  "succeeded_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."customers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "phone" text,
  "document" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."meta_conversion_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "order_id" uuid,
  "event_name" text NOT NULL,
  "event_id" text NOT NULL,
  "status" text DEFAULT 'PENDING'::text NOT NULL,
  "meta_event_id" text,
  "http_status" integer,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."meta_tracking_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "pixel_id" text,
  "access_token_ciphertext" text,
  "access_token_last4" text,
  "test_event_code" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."order_attribution" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_content" text,
  "utm_term" text,
  "gclid" text,
  "fbclid" text,
  "ttclid" text,
  "msclkid" text,
  "gbraid" text,
  "wbraid" text,
  "fbp" text,
  "fbc" text,
  "referrer" text,
  "landing_page" text,
  "click_id" text,
  "checkout_session_id" text,
  "anonymous_session_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "client_ip" text,
  "client_user_agent" text,
  "event_source_url" text
);

CREATE TABLE public."order_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "product_name" text NOT NULL,
  "sku" text NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "quantity" integer NOT NULL,
  "total_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."orders" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "order_number" text NOT NULL,
  "customer_id" uuid,
  "shipping_address_id" uuid,
  "status" order_status DEFAULT 'PENDING_PAYMENT'::order_status NOT NULL,
  "environment" payment_environment NOT NULL,
  "currency" text DEFAULT 'BRL'::text NOT NULL,
  "subtotal_cents" integer DEFAULT 0 NOT NULL,
  "shipping_cents" integer DEFAULT 0 NOT NULL,
  "discount_cents" integer DEFAULT 0 NOT NULL,
  "total_cents" integer DEFAULT 0 NOT NULL,
  "shipping_method" text,
  "stock_reserved" boolean DEFAULT false NOT NULL,
  "stock_committed" boolean DEFAULT false NOT NULL,
  "origin_hhf" boolean DEFAULT false NOT NULL,
  "public_token" text NOT NULL,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."payment_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid,
  "order_id" uuid,
  "type" text NOT NULL,
  "message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."payments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "provider" payment_provider DEFAULT 'STRIPE'::payment_provider NOT NULL,
  "provider_payment_id" text,
  "integration_id" uuid,
  "amount_cents" integer NOT NULL,
  "refunded_cents" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'BRL'::text NOT NULL,
  "status" payment_status DEFAULT 'REQUIRES_PAYMENT'::payment_status NOT NULL,
  "environment" payment_environment NOT NULL,
  "payment_method" text,
  "attempt" integer DEFAULT 1 NOT NULL,
  "idempotency_key" text NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."presence_sessions" (
  "session_id" text NOT NULL,
  "store_id" uuid,
  "state" text DEFAULT 'ACTIVE'::text NOT NULL,
  "page" text,
  "user_agent" text,
  "is_bot" boolean DEFAULT false NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cart_opened_at" timestamp with time zone,
  "cart_closed_at" timestamp with time zone,
  "checkout_viewed_at" timestamp with time zone
);

CREATE TABLE public."products" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "sku" text NOT NULL,
  "price_cents" integer NOT NULL,
  "currency" text DEFAULT 'BRL'::text NOT NULL,
  "stock" integer DEFAULT 0 NOT NULL,
  "reserved_stock" integer DEFAULT 0 NOT NULL,
  "weight_grams" integer DEFAULT 500 NOT NULL,
  "image_url" text,
  "category" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."rate_limit_counters" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "bucket" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 1 NOT NULL
);

CREATE TABLE public."refunds" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "provider_refund_id" text,
  "amount_cents" integer NOT NULL,
  "reason" text,
  "status" refund_status DEFAULT 'PENDING'::refund_status NOT NULL,
  "requested_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."store_api_key_scopes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "api_key_id" uuid NOT NULL,
  "store_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."store_api_keys" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "label" text DEFAULT 'default'::text NOT NULL,
  "key_id" text NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "status" api_key_status DEFAULT 'ACTIVE'::api_key_status NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "encrypted_key" text
);

CREATE TABLE public."stores" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "domain" text,
  "status" store_status DEFAULT 'ACTIVE'::store_status NOT NULL,
  "environment" payment_environment DEFAULT 'test'::payment_environment NOT NULL,
  "stripe_integration_id" uuid,
  "allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
  "currency" text DEFAULT 'BRL'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."stripe_integrations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "environment" payment_environment NOT NULL,
  "publishable_key" text NOT NULL,
  "secret_key_ciphertext" text,
  "secret_key_last4" text,
  "webhook_secret_ciphertext" text,
  "stripe_account_id" text,
  "status" integration_status DEFAULT 'INACTIVE'::integration_status NOT NULL,
  "connection_error" text,
  "last_validated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payment_method_configuration_id" text
);

CREATE TABLE public."utmify_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "order_id" uuid,
  "order_number" text,
  "event_status" text DEFAULT 'paid'::text NOT NULL,
  "status" text DEFAULT 'PENDING'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "http_status" integer,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."utmify_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "webhook_id" text,
  "api_token_ciphertext" text,
  "api_token_last4" text,
  "enabled" boolean DEFAULT false NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "last_success_at" timestamp with time zone,
  "last_order_number" text,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."webhook_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "provider" payment_provider DEFAULT 'STRIPE'::payment_provider NOT NULL,
  "stripe_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "livemode" boolean DEFAULT false NOT NULL,
  "integration_id" uuid,
  "processed" boolean DEFAULT false NOT NULL,
  "processing_status" webhook_processing_status DEFAULT 'RECEIVED'::webhook_processing_status NOT NULL,
  "error_message" text,
  "payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);

ALTER TABLE public."addresses" ADD CONSTRAINT "addresses_pkey" PRIMARY KEY (id);

ALTER TABLE public."analytics_events" ADD CONSTRAINT "analytics_events_event_id_key" UNIQUE (event_id);

ALTER TABLE public."analytics_events" ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."audit_logs" ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id);

ALTER TABLE public."checkout_sessions" ADD CONSTRAINT "checkout_sessions_checkout_session_id_key" UNIQUE (checkout_session_id);

ALTER TABLE public."checkout_sessions" ADD CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY (id);

ALTER TABLE public."customers" ADD CONSTRAINT "customers_pkey" PRIMARY KEY (id);

ALTER TABLE public."customers" ADD CONSTRAINT "customers_store_id_email_key" UNIQUE (store_id, email);

ALTER TABLE public."meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_store_id_event_id_event_name_key" UNIQUE (store_id, event_id, event_name);

ALTER TABLE public."meta_tracking_settings" ADD CONSTRAINT "meta_tracking_settings_pkey" PRIMARY KEY (id);

ALTER TABLE public."meta_tracking_settings" ADD CONSTRAINT "meta_tracking_settings_store_id_key" UNIQUE (store_id);

ALTER TABLE public."order_attribution" ADD CONSTRAINT "order_attribution_order_id_key" UNIQUE (order_id);

ALTER TABLE public."order_attribution" ADD CONSTRAINT "order_attribution_pkey" PRIMARY KEY (id);

ALTER TABLE public."order_items" ADD CONSTRAINT "order_items_pkey" PRIMARY KEY (id);

ALTER TABLE public."order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK (quantity > 0);

ALTER TABLE public."orders" ADD CONSTRAINT "orders_order_number_key" UNIQUE (order_number);

ALTER TABLE public."orders" ADD CONSTRAINT "orders_pkey" PRIMARY KEY (id);

ALTER TABLE public."orders" ADD CONSTRAINT "orders_public_token_key" UNIQUE (public_token);

ALTER TABLE public."payment_events" ADD CONSTRAINT "payment_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."payments" ADD CONSTRAINT "payments_idempotency_key_key" UNIQUE (idempotency_key);

ALTER TABLE public."payments" ADD CONSTRAINT "payments_pkey" PRIMARY KEY (id);

ALTER TABLE public."payments" ADD CONSTRAINT "payments_provider_provider_payment_id_key" UNIQUE (provider, provider_payment_id);

ALTER TABLE public."presence_sessions" ADD CONSTRAINT "presence_sessions_pkey" PRIMARY KEY (session_id);

ALTER TABLE public."presence_sessions" ADD CONSTRAINT "presence_sessions_state_check" CHECK (state = ANY (ARRAY['ACTIVE'::text, 'CART'::text, 'CHECKOUT'::text, 'PAID'::text, 'ENDED'::text]));

ALTER TABLE public."products" ADD CONSTRAINT "products_pkey" PRIMARY KEY (id);

ALTER TABLE public."products" ADD CONSTRAINT "products_price_cents_check" CHECK (price_cents >= 0);

ALTER TABLE public."products" ADD CONSTRAINT "products_reserved_stock_check" CHECK (reserved_stock >= 0);

ALTER TABLE public."products" ADD CONSTRAINT "products_stock_check" CHECK (stock >= 0);

ALTER TABLE public."products" ADD CONSTRAINT "products_store_id_sku_key" UNIQUE (store_id, sku);

ALTER TABLE public."products" ADD CONSTRAINT "products_store_id_slug_key" UNIQUE (store_id, slug);

ALTER TABLE public."rate_limit_counters" ADD CONSTRAINT "rate_limit_counters_bucket_window_start_key" UNIQUE (bucket, window_start);

ALTER TABLE public."rate_limit_counters" ADD CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY (id);

ALTER TABLE public."refunds" ADD CONSTRAINT "refunds_amount_cents_check" CHECK (amount_cents > 0);

ALTER TABLE public."refunds" ADD CONSTRAINT "refunds_pkey" PRIMARY KEY (id);

ALTER TABLE public."refunds" ADD CONSTRAINT "refunds_provider_refund_id_key" UNIQUE (provider_refund_id);

ALTER TABLE public."store_api_key_scopes" ADD CONSTRAINT "store_api_key_scopes_api_key_id_store_id_key" UNIQUE (api_key_id, store_id);

ALTER TABLE public."store_api_key_scopes" ADD CONSTRAINT "store_api_key_scopes_pkey" PRIMARY KEY (id);

ALTER TABLE public."store_api_keys" ADD CONSTRAINT "store_api_keys_key_id_key" UNIQUE (key_id);

ALTER TABLE public."store_api_keys" ADD CONSTRAINT "store_api_keys_pkey" PRIMARY KEY (id);

ALTER TABLE public."stores" ADD CONSTRAINT "stores_pkey" PRIMARY KEY (id);

ALTER TABLE public."stores" ADD CONSTRAINT "stores_slug_key" UNIQUE (slug);

ALTER TABLE public."stripe_integrations" ADD CONSTRAINT "stripe_integrations_pkey" PRIMARY KEY (id);

ALTER TABLE public."utmify_events" ADD CONSTRAINT "utmify_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."utmify_events" ADD CONSTRAINT "utmify_events_store_id_order_id_event_status_key" UNIQUE (store_id, order_id, event_status);

ALTER TABLE public."utmify_settings" ADD CONSTRAINT "utmify_settings_pkey" PRIMARY KEY (id);

ALTER TABLE public."utmify_settings" ADD CONSTRAINT "utmify_settings_store_id_key" UNIQUE (store_id);

ALTER TABLE public."webhook_events" ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY (id);

ALTER TABLE public."webhook_events" ADD CONSTRAINT "webhook_events_provider_stripe_event_id_key" UNIQUE (provider, stripe_event_id);

ALTER TABLE public."addresses" ADD CONSTRAINT "addresses_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;

ALTER TABLE public."addresses" ADD CONSTRAINT "addresses_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."analytics_events" ADD CONSTRAINT "analytics_events_integration_id_fkey" FOREIGN KEY (integration_id) REFERENCES stripe_integrations(id);

ALTER TABLE public."analytics_events" ADD CONSTRAINT "analytics_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id);

ALTER TABLE public."analytics_events" ADD CONSTRAINT "analytics_events_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id);

ALTER TABLE public."checkout_sessions" ADD CONSTRAINT "checkout_sessions_integration_id_fkey" FOREIGN KEY (integration_id) REFERENCES stripe_integrations(id);

ALTER TABLE public."checkout_sessions" ADD CONSTRAINT "checkout_sessions_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id);

ALTER TABLE public."checkout_sessions" ADD CONSTRAINT "checkout_sessions_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id);

ALTER TABLE public."customers" ADD CONSTRAINT "customers_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE public."meta_conversion_events" ADD CONSTRAINT "meta_conversion_events_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."meta_tracking_settings" ADD CONSTRAINT "meta_tracking_settings_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."order_attribution" ADD CONSTRAINT "order_attribution_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;

ALTER TABLE public."orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE public."orders" ADD CONSTRAINT "orders_shipping_address_id_fkey" FOREIGN KEY (shipping_address_id) REFERENCES addresses(id) ON DELETE SET NULL;

ALTER TABLE public."orders" ADD CONSTRAINT "orders_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;

ALTER TABLE public."payment_events" ADD CONSTRAINT "payment_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;

ALTER TABLE public."payments" ADD CONSTRAINT "payments_integration_id_fkey" FOREIGN KEY (integration_id) REFERENCES stripe_integrations(id) ON DELETE SET NULL;

ALTER TABLE public."payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE public."payments" ADD CONSTRAINT "payments_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;

ALTER TABLE public."presence_sessions" ADD CONSTRAINT "presence_sessions_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE public."products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;

ALTER TABLE public."refunds" ADD CONSTRAINT "refunds_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT;

ALTER TABLE public."store_api_key_scopes" ADD CONSTRAINT "store_api_key_scopes_api_key_id_fkey" FOREIGN KEY (api_key_id) REFERENCES store_api_keys(id) ON DELETE CASCADE;

ALTER TABLE public."store_api_key_scopes" ADD CONSTRAINT "store_api_key_scopes_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."store_api_keys" ADD CONSTRAINT "store_api_keys_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."stores" ADD CONSTRAINT "stores_stripe_integration_id_fkey" FOREIGN KEY (stripe_integration_id) REFERENCES stripe_integrations(id) ON DELETE SET NULL;

ALTER TABLE public."utmify_events" ADD CONSTRAINT "utmify_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE public."utmify_events" ADD CONSTRAINT "utmify_events_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."utmify_settings" ADD CONSTRAINT "utmify_settings_store_id_fkey" FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE public."webhook_events" ADD CONSTRAINT "webhook_events_integration_id_fkey" FOREIGN KEY (integration_id) REFERENCES stripe_integrations(id) ON DELETE SET NULL;

CREATE INDEX idx_analytics_events_integration ON public.analytics_events USING btree (integration_id);

CREATE INDEX idx_analytics_events_method ON public.analytics_events USING btree (payment_method);

CREATE INDEX idx_analytics_events_pi ON public.analytics_events USING btree (payment_intent_id);

CREATE INDEX idx_analytics_events_session ON public.analytics_events USING btree (checkout_session_id);

CREATE INDEX idx_analytics_events_store_time ON public.analytics_events USING btree (store_id, occurred_at DESC);

CREATE INDEX idx_analytics_events_type_time ON public.analytics_events USING btree (event_type, occurred_at DESC);

CREATE INDEX idx_checkout_sessions_order ON public.checkout_sessions USING btree (order_id);

CREATE INDEX idx_checkout_sessions_store_time ON public.checkout_sessions USING btree (store_id, first_seen_at DESC);

CREATE INDEX idx_meta_conversion_events_store_status ON public.meta_conversion_events USING btree (store_id, status, created_at DESC);

CREATE UNIQUE INDEX meta_conversion_events_store_order_event_key ON public.meta_conversion_events USING btree (store_id, order_id, event_name) WHERE (order_id IS NOT NULL);

CREATE INDEX idx_order_attribution_order_id ON public.order_attribution USING btree (order_id);

CREATE INDEX idx_orders_store ON public.orders USING btree (store_id, created_at DESC);

CREATE UNIQUE INDEX idx_payments_active_order ON public.payments USING btree (order_id) WHERE (status = ANY (ARRAY['REQUIRES_PAYMENT'::payment_status, 'PROCESSING'::payment_status]));

CREATE INDEX presence_sessions_last_seen_idx ON public.presence_sessions USING btree (last_seen_at DESC);

CREATE INDEX presence_sessions_store_state_idx ON public.presence_sessions USING btree (store_id, state, last_seen_at DESC);

CREATE OR REPLACE FUNCTION public.bump_rate_limit(_bucket text, _window_seconds integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _win TIMESTAMPTZ; _count INTEGER;
BEGIN
  _win := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);
  INSERT INTO public.rate_limit_counters (bucket, window_start, count)
  VALUES (_bucket, _win, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET count = public.rate_limit_counters.count + 1
  RETURNING count INTO _count;
  DELETE FROM public.rate_limit_counters WHERE window_start < now() - INTERVAL '1 day';
  RETURN _count;
END; $function$
;

CREATE OR REPLACE FUNCTION public.commit_order_stock(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.products p
     SET stock = GREATEST(p.stock - oi.quantity, 0),
         reserved_stock = GREATEST(p.reserved_stock - oi.quantity, 0)
    FROM public.order_items oi
   WHERE oi.order_id = _order_id AND oi.product_id = p.id;
  UPDATE public.orders SET stock_committed = true, stock_reserved = false WHERE id = _order_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.release_order_stock(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.products p SET reserved_stock = GREATEST(p.reserved_stock - oi.quantity, 0)
    FROM public.order_items oi
   WHERE oi.order_id = _order_id AND oi.product_id = p.id;
  UPDATE public.orders SET stock_reserved = false WHERE id = _order_id;
END; $function$
;

CREATE OR REPLACE FUNCTION public.reserve_stock(_product_id uuid, _qty integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _ok INTEGER;
BEGIN
  UPDATE public.products
     SET reserved_stock = reserved_stock + _qty
   WHERE id = _product_id AND active = true AND (stock - reserved_stock) >= _qty;
  GET DIAGNOSTICS _ok = ROW_COUNT;
  RETURN _ok = 1;
END; $function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;

CREATE TABLE public."marketing_codes" (
  "code" text PRIMARY KEY,
  "utm_source" text NOT NULL,
  "utm_medium" text NOT NULL,
  "utm_campaign" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
