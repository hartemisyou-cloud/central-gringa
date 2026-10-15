-- Central portable post-data schema, derived verbatim from the official backup.
-- Explicit adaptations: remove Supabase client policies and two auth.users foreign keys;
-- remove psql-only restrict commands; restore normal session controls after loading.
-- Full preservation/exclusion manifest: schema-adaptations.json.
-- No data rows, credentials or ebook contents are included.

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

SET default_tablespace = '';

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

-- Removed profiles_id_fkey: no auth.users in the audited snapshot; preserve all legacy rows.


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

-- Removed user_roles_user_id_fkey: no auth.users in the audited snapshot; preserve all legacy rows.


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

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: cart_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: carts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: checkout_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


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

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: meta_tracking_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_tracking_settings ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: order_attribution; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_attribution ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: presence_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.presence_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


-- Supabase client policy removed; see003_server_acl.sql.


-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: rate_limit_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: store_api_key_scopes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_api_key_scopes ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: store_api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_api_keys ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: stores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: stripe_checkout_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: stripe_integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_integrations ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


-- Supabase client policy removed; see003_server_acl.sql.


-- Supabase client policy removed; see003_server_acl.sql.


-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: utmify_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.utmify_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: utmify_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.utmify_settings ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Supabase client policy removed; see003_server_acl.sql.


--
-- PostgreSQL database dump complete
--



SET check_function_bodies = true;
SET row_security = on;
SET search_path = public, pg_catalog;
