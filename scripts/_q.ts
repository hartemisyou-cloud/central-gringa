import { supabaseAdmin } from "@/integrations/supabase/client.server";
const s = await supabaseAdmin.from("stores").select("id,slug,name,environment,stripe_integration_id,currency,status,domain").order("created_at");
console.log(JSON.stringify(s.data,null,1), s.error?.message);
const i = await supabaseAdmin.from("stripe_integrations").select("id,name,environment,status,publishable_key,secret_key_last4,stripe_account_id,payment_method_configuration_id,webhook_secret_ciphertext").order("created_at");
console.log(JSON.stringify(i.data?.map(x=>({...x,webhook_secret_ciphertext: x.webhook_secret_ciphertext? "set":null})),null,1), i.error?.message);
