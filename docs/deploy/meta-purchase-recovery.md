# Purchase-only recovery rollout

Prepared locally, not deployed. This is an incremental PostgreSQL/Vercel change;
do not publish the Lovable copy as a substitute for the backend serving the domain.

## Verify the destination before rollout

1. In Vercel, find the production deployment serving hopehumanbooks.com and record
   its project, SHA and Production Branch. The local `vercel-migration` reference
   exists, but does not establish the branch of that deployment.
2. Confirm the Stripe event destination routes to that deployment's
   `/api/public/webhooks/stripe/<integrationId>` and that the integration belongs
   to the intended store. Do not rotate Stripe credentials or change destinations.
3. Verify the store's configured browser Pixel and CAPI destination agree through
   the existing public/private store configuration. Do not substitute an ID seen
   on the home page. Browser Purchase is not currently enabled; keep it server-only.

## Apply only the incremental migration

Use the existing production owner connection to apply
`migrations/007_meta_purchase_recovery.sql` before deploying code. Do not run the
full database restore or seed historical sales. Existing rows retain
`automatic_recovery=false`; runtime keeps its existing SELECT/INSERT/UPDATE grants
and RLS. Snapshot content is encrypted with the existing payment encryption key;
never return or log the snapshot or that key. No database change was applied here.

## Activate on the correct Vercel project

- Configure a strong server-only `CRON_SECRET` in the project's secure environment
  settings. Vercel Cron sends it as an Authorization bearer; no publishable key
  can authorize this route. Never paste its value into chat or the repository.
- Set `META_PURCHASE_RECOVERY_FROM` to the UTC activation instant, ISO 8601.
- Set `META_PURCHASE_RECOVERY_ENABLED=true` only after verifying the existing
  advertising permission/withdrawal mechanisms and dataset restrictions. This
  switch is operational, not a consent record. No consent mechanism was added,
  bypassed or declared verified in this change.
- Deploy the reviewed diff through the verified production branch/project.
- Confirm Vercel accepted the five-minute cron entry. This requires a Vercel plan
  supporting sub-daily cron. If unsupported, do not silently downgrade to daily
  recovery; configure an authenticated compatible scheduler before activation.

The schedule runs up to 288 times/day with up to five eligible rows per tick.
An eligible failed attempt waits up to roughly five minutes plus execution time
when capacity is available; outages/backlog can increase this. This is a recurring
invocation-cost versus recovery-delay tradeoff, not an in-process timer.

## Guarantees and limitations

- Signed paid Checkout completion/async success drives the server Purchase even
  without any thank-you page navigation. The payment method does not gate this
  path. Unpaid/mismatched Sessions remain excluded.
- Original signed confirmation event's `created` supplies the occurrence time;
  the Session's `created` is not used as payment time. Saved snapshot remains
  immutable across later webhooks/order/settings changes.
- Full-batch `events_received` acknowledgement is required for SENT. Claim and
  returned-row completion fencing are shared PostgreSQL operations.
- A changed dataset fails closed rather than sending to a replacement. Current
  store enablement is rechecked before retries. Expired payloads are not retimed.
- Unknown remote result is recorded independently; an expired final claim is
  exhausted/unknown, never automatically sent a fifth time.
- The scheduler processes only enrolled snapshots from new eligible occurrences,
  never old rows, and does not reset counters. A pre-persistence dispatch failure
  leaves the webhook retryable; a persisted transient failure uses the worker.
- Remote receipt, actual deduplication and Ads attribution require production
  evidence; local tests do not establish any of those.

Validate with the existing TEST integration/test dataset or isolated staging,
not fictional LIVE sales. Record deployed SHA, signed webhook result, original
event ID/time/value/destination, worker tick and Meta acknowledgement. Preserve
consent evidence, disclosure, applicable withdrawal and dataset restrictions.