import { decryptSecret } from "@/lib/payments/crypto.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
const ID = "bd5fa57d-e1ea-432c-a89d-21c6f7b5af33";
const URL_ = `https://stripe-hub.lovable.app/api/public/webhooks/stripe/${ID}`;
const { data } = await supabaseAdmin.from("stripe_integrations").select("webhook_secret_ciphertext,environment").eq("id", ID).single();
const secret = await decryptSecret(data!.webhook_secret_ciphertext!);
const eventId = `evt_synthetic_${Date.now()}`;
const payload = JSON.stringify({
  id: eventId, type: "payment_intent.succeeded", livemode: data!.environment === "live",
  created: Math.floor(Date.now()/1000),
  data: { object: { id: `pi_SYNTHETIC_TEST_${Date.now()}`, object: "payment_intent", amount: 100, currency: "usd", status: "succeeded" } },
});
async function sign(sec: string, ts: number, body: string) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(sec), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(`${ts}.${body}`));
  return [...new Uint8Array(s)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
const ts = Math.floor(Date.now()/1000);
async function post(sig: string|null, body=payload, label="") {
  const r = await fetch(URL_, { method:"POST", headers: { "content-type":"application/json", ...(sig?{"stripe-signature":sig}:{}) }, body });
  console.log(label, r.status, (await r.text()).slice(0,300));
}
await post(`t=${ts},v1=${await sign(secret, ts, payload)}`, payload, "A valid-signature:");
await post(`t=${ts},v1=${"0".repeat(64)}`, payload, "B bad-signature:");
await post(null, payload, "C no-signature:");
const oldTs = ts - 4000;
await post(`t=${oldTs},v1=${await sign(secret, oldTs, payload)}`, payload, "D expired-ts:");
await post(`t=${ts},v1=${await sign(secret, ts, payload)}`, payload, "E replay-same-event:");
// verify side effects
const we = await supabaseAdmin.from("webhook_events").select("stripe_event_id,event_type,processed,processing_status,error_message").eq("stripe_event_id", eventId);
console.log("webhook_events:", JSON.stringify(we.data));
const o = await supabaseAdmin.from("orders").select("id").eq("status","PAID").gte("updated_at", new Date(Date.now()-600000).toISOString());
console.log("orders PAID touched last 10min:", o.data?.length);
