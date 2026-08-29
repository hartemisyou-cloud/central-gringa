import { supabaseAdmin } from "@/integrations/supabase/client.server";
for (const t of ["products","meta_tracking_settings","utmify_settings","store_api_keys"]) {
  const r = await supabaseAdmin.from(t as never).select("*");
  console.log(t, r.data?.length, r.error?.message, Object.keys((r.data as any)?.[0] ?? {}).join(","));
}
