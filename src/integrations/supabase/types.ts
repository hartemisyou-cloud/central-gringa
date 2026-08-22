export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          city: string
          complement: string | null
          country: string
          created_at: string
          customer_id: string | null
          district: string
          id: string
          number: string
          phone: string | null
          postal_code: string
          recipient_name: string
          state: string
          store_id: string
          street: string
        }
        Insert: {
          city: string
          complement?: string | null
          country?: string
          created_at?: string
          customer_id?: string | null
          district: string
          id?: string
          number: string
          phone?: string | null
          postal_code: string
          recipient_name: string
          state: string
          store_id: string
          street: string
        }
        Update: {
          city?: string
          complement?: string | null
          country?: string
          created_at?: string
          customer_id?: string | null
          district?: string
          id?: string
          number?: string
          phone?: string | null
          postal_code?: string
          recipient_name?: string
          state?: string
          store_id?: string
          street?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          amount_cents: number | null
          anonymous_session_id: string | null
          browser: string | null
          checkout_session_id: string | null
          country: string | null
          currency: string | null
          decline_category: string | null
          decline_code: string | null
          device_type: string | null
          event_id: string
          event_type: string
          id: string
          integration_id: string | null
          metadata: Json
          occurred_at: string
          operating_system: string | null
          order_id: string | null
          payment_intent_id: string | null
          payment_method: string | null
          public_token: string | null
          received_at: string
          referrer: string | null
          source: string
          store_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          anonymous_session_id?: string | null
          browser?: string | null
          checkout_session_id?: string | null
          country?: string | null
          currency?: string | null
          decline_category?: string | null
          decline_code?: string | null
          device_type?: string | null
          event_id: string
          event_type: string
          id?: string
          integration_id?: string | null
          metadata?: Json
          occurred_at?: string
          operating_system?: string | null
          order_id?: string | null
          payment_intent_id?: string | null
          payment_method?: string | null
          public_token?: string | null
          received_at?: string
          referrer?: string | null
          source?: string
          store_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          anonymous_session_id?: string | null
          browser?: string | null
          checkout_session_id?: string | null
          country?: string | null
          currency?: string | null
          decline_category?: string | null
          decline_code?: string | null
          device_type?: string | null
          event_id?: string
          event_type?: string
          id?: string
          integration_id?: string | null
          metadata?: Json
          occurred_at?: string
          operating_system?: string | null
          order_id?: string | null
          payment_intent_id?: string | null
          payment_method?: string | null
          public_token?: string | null
          received_at?: string
          referrer?: string | null
          source?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "stripe_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          ip: string | null
          metadata: Json
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          product_id: string
          quantity: number
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          product_id: string
          quantity: number
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          id: string
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_sessions: {
        Row: {
          amount_cents: number | null
          anonymous_session_id: string
          attempted_at: string | null
          browser: string | null
          checkout_session_id: string
          country: string | null
          currency: string | null
          device_type: string | null
          first_seen_at: string
          id: string
          integration_id: string | null
          last_seen_at: string
          operating_system: string | null
          order_id: string | null
          payment_intent_id: string | null
          public_token: string | null
          referrer: string | null
          started_at: string | null
          status: string
          store_id: string | null
          succeeded_at: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          viewed_at: string | null
        }
        Insert: {
          amount_cents?: number | null
          anonymous_session_id: string
          attempted_at?: string | null
          browser?: string | null
          checkout_session_id: string
          country?: string | null
          currency?: string | null
          device_type?: string | null
          first_seen_at?: string
          id?: string
          integration_id?: string | null
          last_seen_at?: string
          operating_system?: string | null
          order_id?: string | null
          payment_intent_id?: string | null
          public_token?: string | null
          referrer?: string | null
          started_at?: string | null
          status?: string
          store_id?: string | null
          succeeded_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewed_at?: string | null
        }
        Update: {
          amount_cents?: number | null
          anonymous_session_id?: string
          attempted_at?: string | null
          browser?: string | null
          checkout_session_id?: string
          country?: string | null
          currency?: string | null
          device_type?: string | null
          first_seen_at?: string
          id?: string
          integration_id?: string | null
          last_seen_at?: string
          operating_system?: string | null
          order_id?: string | null
          payment_intent_id?: string | null
          public_token?: string | null
          referrer?: string | null
          started_at?: string | null
          status?: string
          store_id?: string | null
          succeeded_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkout_sessions_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "stripe_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          document: string | null
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document?: string | null
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document?: string | null
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_conversion_events: {
        Row: {
          attempt_count: number
          created_at: string
          event_id: string
          event_name: string
          http_status: number | null
          id: string
          last_error: string | null
          meta_event_id: string | null
          order_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          event_id: string
          event_name: string
          http_status?: number | null
          id?: string
          last_error?: string | null
          meta_event_id?: string | null
          order_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          event_id?: string
          event_name?: string
          http_status?: number | null
          id?: string
          last_error?: string | null
          meta_event_id?: string | null
          order_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_conversion_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversion_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_tracking_settings: {
        Row: {
          access_token_ciphertext: string | null
          access_token_last4: string | null
          created_at: string
          enabled: boolean
          id: string
          last_error: string | null
          last_error_at: string | null
          last_success_at: string | null
          pixel_id: string | null
          store_id: string
          test_event_code: string | null
          updated_at: string
        }
        Insert: {
          access_token_ciphertext?: string | null
          access_token_last4?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          pixel_id?: string | null
          store_id: string
          test_event_code?: string | null
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string | null
          access_token_last4?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          last_success_at?: string | null
          pixel_id?: string | null
          store_id?: string
          test_event_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_tracking_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      order_attribution: {
        Row: {
          anonymous_session_id: string | null
          checkout_session_id: string | null
          click_id: string | null
          client_ip: string | null
          client_user_agent: string | null
          created_at: string
          event_source_url: string | null
          fbc: string | null
          fbclid: string | null
          fbp: string | null
          gbraid: string | null
          gclid: string | null
          id: string
          landing_page: string | null
          msclkid: string | null
          order_id: string
          referrer: string | null
          ttclid: string | null
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          wbraid: string | null
        }
        Insert: {
          anonymous_session_id?: string | null
          checkout_session_id?: string | null
          click_id?: string | null
          client_ip?: string | null
          client_user_agent?: string | null
          created_at?: string
          event_source_url?: string | null
          fbc?: string | null
          fbclid?: string | null
          fbp?: string | null
          gbraid?: string | null
          gclid?: string | null
          id?: string
          landing_page?: string | null
          msclkid?: string | null
          order_id: string
          referrer?: string | null
          ttclid?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Update: {
          anonymous_session_id?: string | null
          checkout_session_id?: string | null
          click_id?: string | null
          client_ip?: string | null
          client_user_agent?: string | null
          created_at?: string
          event_source_url?: string | null
          fbc?: string | null
          fbclid?: string | null
          fbp?: string | null
          gbraid?: string | null
          gclid?: string | null
          id?: string
          landing_page?: string | null
          msclkid?: string | null
          order_id?: string
          referrer?: string | null
          ttclid?: string | null
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_attribution_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sku: string
          total_cents: number
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sku: string
          total_cents: number
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          sku?: string
          total_cents?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          customer_id: string | null
          discount_cents: number
          environment: Database["public"]["Enums"]["payment_environment"]
          id: string
          order_number: string
          paid_at: string | null
          public_token: string
          shipping_address_id: string | null
          shipping_cents: number
          shipping_method: string | null
          status: Database["public"]["Enums"]["order_status"]
          stock_committed: boolean
          stock_reserved: boolean
          store_id: string
          subtotal_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          discount_cents?: number
          environment: Database["public"]["Enums"]["payment_environment"]
          id?: string
          order_number: string
          paid_at?: string | null
          public_token: string
          shipping_address_id?: string | null
          shipping_cents?: number
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          stock_committed?: boolean
          stock_reserved?: boolean
          store_id: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          discount_cents?: number
          environment?: Database["public"]["Enums"]["payment_environment"]
          id?: string
          order_number?: string
          paid_at?: string | null
          public_token?: string
          shipping_address_id?: string | null
          shipping_cents?: number
          shipping_method?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          stock_committed?: boolean
          stock_reserved?: boolean
          store_id?: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shipping_address_id_fkey"
            columns: ["shipping_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          id: string
          message: string | null
          metadata: Json
          order_id: string | null
          payment_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          order_id?: string | null
          payment_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          order_id?: string | null
          payment_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          attempt: number
          created_at: string
          currency: string
          environment: Database["public"]["Enums"]["payment_environment"]
          id: string
          idempotency_key: string
          integration_id: string | null
          last_error: string | null
          order_id: string
          payment_method: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id: string | null
          refunded_cents: number
          status: Database["public"]["Enums"]["payment_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          attempt?: number
          created_at?: string
          currency?: string
          environment: Database["public"]["Enums"]["payment_environment"]
          id?: string
          idempotency_key: string
          integration_id?: string | null
          last_error?: string | null
          order_id: string
          payment_method?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id?: string | null
          refunded_cents?: number
          status?: Database["public"]["Enums"]["payment_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attempt?: number
          created_at?: string
          currency?: string
          environment?: Database["public"]["Enums"]["payment_environment"]
          id?: string
          idempotency_key?: string
          integration_id?: string | null
          last_error?: string | null
          order_id?: string
          payment_method?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_payment_id?: string | null
          refunded_cents?: number
          status?: Database["public"]["Enums"]["payment_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "stripe_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          price_cents: number | null
          product_id: string
          sku: string
          stock: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          price_cents?: number | null
          product_id: string
          sku: string
          stock?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          price_cents?: number | null
          product_id?: string
          sku?: string
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          price_cents: number
          reserved_stock: number
          sku: string
          slug: string
          stock: number
          store_id: string
          updated_at: string
          weight_grams: number
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          price_cents: number
          reserved_stock?: number
          sku: string
          slug: string
          stock?: number
          store_id: string
          updated_at?: string
          weight_grams?: number
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          price_cents?: number
          reserved_stock?: number
          sku?: string
          slug?: string
          stock?: number
          store_id?: string
          updated_at?: string
          weight_grams?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          count: number
          id: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          id?: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          id?: string
          window_start?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          payment_id: string
          provider_refund_id: string | null
          reason: string | null
          requested_by: string | null
          status: Database["public"]["Enums"]["refund_status"]
          store_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          payment_id: string
          provider_refund_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          store_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          payment_id?: string
          provider_refund_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_api_key_scopes: {
        Row: {
          api_key_id: string
          created_at: string
          id: string
          store_id: string
        }
        Insert: {
          api_key_id: string
          created_at?: string
          id?: string
          store_id: string
        }
        Update: {
          api_key_id?: string
          created_at?: string
          id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_api_key_scopes_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "store_api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_api_key_scopes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          encrypted_key: string | null
          id: string
          key_hash: string
          key_id: string
          key_prefix: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          status: Database["public"]["Enums"]["api_key_status"]
          store_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          encrypted_key?: string | null
          id?: string
          key_hash: string
          key_id: string
          key_prefix: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["api_key_status"]
          store_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          encrypted_key?: string | null
          id?: string
          key_hash?: string
          key_id?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["api_key_status"]
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_api_keys_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          allowed_origins: string[]
          created_at: string
          currency: string
          domain: string | null
          environment: Database["public"]["Enums"]["payment_environment"]
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["store_status"]
          stripe_integration_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_origins?: string[]
          created_at?: string
          currency?: string
          domain?: string | null
          environment?: Database["public"]["Enums"]["payment_environment"]
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["store_status"]
          stripe_integration_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_origins?: string[]
          created_at?: string
          currency?: string
          domain?: string | null
          environment?: Database["public"]["Enums"]["payment_environment"]
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["store_status"]
          stripe_integration_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_stripe_integration_id_fkey"
            columns: ["stripe_integration_id"]
            isOneToOne: false
            referencedRelation: "stripe_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_checkout_sessions: {
        Row: {
          amount_total: number | null
          base_amount_cents: number
          base_currency: string
          client_secret: string | null
          created_at: string
          currency: string | null
          expires_at: string | null
          id: string
          integration_id: string | null
          order_id: string
          payment_intent_id: string | null
          presented_amount_total: number | null
          presented_currency: string | null
          session_id: string
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          amount_total?: number | null
          base_amount_cents: number
          base_currency: string
          client_secret?: string | null
          created_at?: string
          currency?: string | null
          expires_at?: string | null
          id?: string
          integration_id?: string | null
          order_id: string
          payment_intent_id?: string | null
          presented_amount_total?: number | null
          presented_currency?: string | null
          session_id: string
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          amount_total?: number | null
          base_amount_cents?: number
          base_currency?: string
          client_secret?: string | null
          created_at?: string
          currency?: string | null
          expires_at?: string | null
          id?: string
          integration_id?: string | null
          order_id?: string
          payment_intent_id?: string | null
          presented_amount_total?: number | null
          presented_currency?: string | null
          session_id?: string
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_checkout_sessions_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "stripe_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_checkout_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stripe_checkout_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_integrations: {
        Row: {
          connection_error: string | null
          created_at: string
          environment: Database["public"]["Enums"]["payment_environment"]
          id: string
          last_validated_at: string | null
          name: string
          payment_method_configuration_id: string | null
          publishable_key: string
          secret_key_ciphertext: string | null
          secret_key_last4: string | null
          status: Database["public"]["Enums"]["integration_status"]
          stripe_account_id: string | null
          updated_at: string
          webhook_secret_ciphertext: string | null
        }
        Insert: {
          connection_error?: string | null
          created_at?: string
          environment: Database["public"]["Enums"]["payment_environment"]
          id?: string
          last_validated_at?: string | null
          name: string
          payment_method_configuration_id?: string | null
          publishable_key: string
          secret_key_ciphertext?: string | null
          secret_key_last4?: string | null
          status?: Database["public"]["Enums"]["integration_status"]
          stripe_account_id?: string | null
          updated_at?: string
          webhook_secret_ciphertext?: string | null
        }
        Update: {
          connection_error?: string | null
          created_at?: string
          environment?: Database["public"]["Enums"]["payment_environment"]
          id?: string
          last_validated_at?: string | null
          name?: string
          payment_method_configuration_id?: string | null
          publishable_key?: string
          secret_key_ciphertext?: string | null
          secret_key_last4?: string | null
          status?: Database["public"]["Enums"]["integration_status"]
          stripe_account_id?: string | null
          updated_at?: string
          webhook_secret_ciphertext?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      utmify_events: {
        Row: {
          attempt_count: number
          created_at: string
          event_status: string
          http_status: number | null
          id: string
          last_error: string | null
          order_id: string | null
          order_number: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          event_status?: string
          http_status?: number | null
          id?: string
          last_error?: string | null
          order_id?: string | null
          order_number?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          event_status?: string
          http_status?: number | null
          id?: string
          last_error?: string | null
          order_id?: string | null
          order_number?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "utmify_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "utmify_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      utmify_settings: {
        Row: {
          api_token_ciphertext: string | null
          api_token_last4: string | null
          created_at: string
          enabled: boolean
          id: string
          is_test: boolean
          last_error: string | null
          last_error_at: string | null
          last_order_number: string | null
          last_success_at: string | null
          store_id: string
          updated_at: string
          webhook_id: string | null
        }
        Insert: {
          api_token_ciphertext?: string | null
          api_token_last4?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          is_test?: boolean
          last_error?: string | null
          last_error_at?: string | null
          last_order_number?: string | null
          last_success_at?: string | null
          store_id: string
          updated_at?: string
          webhook_id?: string | null
        }
        Update: {
          api_token_ciphertext?: string | null
          api_token_last4?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          is_test?: boolean
          last_error?: string | null
          last_error_at?: string | null
          last_order_number?: string | null
          last_success_at?: string | null
          store_id?: string
          updated_at?: string
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "utmify_settings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          error_message: string | null
          event_type: string
          id: string
          integration_id: string | null
          livemode: boolean
          payload_summary: Json
          processed: boolean
          processed_at: string | null
          processing_status: Database["public"]["Enums"]["webhook_processing_status"]
          provider: Database["public"]["Enums"]["payment_provider"]
          received_at: string
          stripe_event_id: string
        }
        Insert: {
          error_message?: string | null
          event_type: string
          id?: string
          integration_id?: string | null
          livemode?: boolean
          payload_summary?: Json
          processed?: boolean
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["webhook_processing_status"]
          provider?: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
          stripe_event_id: string
        }
        Update: {
          error_message?: string | null
          event_type?: string
          id?: string
          integration_id?: string | null
          livemode?: boolean
          payload_summary?: Json
          processed?: boolean
          processed_at?: string | null
          processing_status?: Database["public"]["Enums"]["webhook_processing_status"]
          provider?: Database["public"]["Enums"]["payment_provider"]
          received_at?: string
          stripe_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "stripe_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bump_rate_limit: {
        Args: { _bucket: string; _window_seconds: number }
        Returns: number
      }
      commit_order_stock: { Args: { _order_id: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      release_order_stock: { Args: { _order_id: string }; Returns: undefined }
      reserve_stock: {
        Args: { _product_id: string; _qty: number }
        Returns: boolean
      }
    }
    Enums: {
      api_key_status: "ACTIVE" | "REVOKED"
      app_role: "ADMIN" | "FINANCE" | "SUPPORT"
      integration_status: "ACTIVE" | "INACTIVE" | "ERROR"
      order_status:
        | "PENDING_PAYMENT"
        | "PAYMENT_PROCESSING"
        | "PAID"
        | "PAYMENT_FAILED"
        | "CANCELLED"
        | "REFUNDED"
        | "PARTIALLY_REFUNDED"
      payment_environment: "test" | "live"
      payment_provider: "STRIPE"
      payment_status:
        | "REQUIRES_PAYMENT"
        | "PROCESSING"
        | "SUCCEEDED"
        | "FAILED"
        | "CANCELLED"
        | "REFUNDED"
        | "PARTIALLY_REFUNDED"
      refund_status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED"
      store_status: "ACTIVE" | "INACTIVE"
      webhook_processing_status: "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      api_key_status: ["ACTIVE", "REVOKED"],
      app_role: ["ADMIN", "FINANCE", "SUPPORT"],
      integration_status: ["ACTIVE", "INACTIVE", "ERROR"],
      order_status: [
        "PENDING_PAYMENT",
        "PAYMENT_PROCESSING",
        "PAID",
        "PAYMENT_FAILED",
        "CANCELLED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ],
      payment_environment: ["test", "live"],
      payment_provider: ["STRIPE"],
      payment_status: [
        "REQUIRES_PAYMENT",
        "PROCESSING",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ],
      refund_status: ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED"],
      store_status: ["ACTIVE", "INACTIVE"],
      webhook_processing_status: ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"],
    },
  },
} as const
