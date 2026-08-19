# Edge Functions

## `ingest-steps`

The only door step data comes through (§6.1). Verifies a Play Integrity or
DeviceCheck token, then calls `award_steps` as `service_role`.

Everything downstream of the attestation verdict lives in the database, not
here: the daily cap, the rate ceiling, the 48-hour backfill window, the streak
multiplier and the coin arithmetic are all in `award_steps`. This function's
only job is to answer "is this a real device running our real app", and to fail
closed when it cannot tell.

```bash
supabase functions deploy ingest-steps

supabase secrets set \
  ANDROID_PACKAGE_NAME=pk.qadam.app \
  GOOGLE_SA_CLIENT_EMAIL=... \
  GOOGLE_SA_PRIVATE_KEY="$(cat service-account-key.pem)" \
  APPLE_TEAM_ID=... \
  APPLE_DEVICECHECK_KEY_ID=... \
  APPLE_DEVICECHECK_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)"
```

**Until those secrets exist, every submission is treated as unattested and earns
zero coins.** That is deliberate — see `_shared/attest.ts`. It means the economy
cannot be farmed before anti-fraud is real, which is what §6 asks for, but it
also means nobody earns anything on a hosted project until the keys are set. The
credentials are tracked in `HUMAN_TASKS.md`.

## `send-confirmations`

§7.5's pre-dispatch WhatsApp message, with confirm and cancel buttons. Runs on a
schedule rather than inline with checkout, so a WhatsApp outage delays a shipment
instead of failing an order that is otherwise fine — the database already refuses
to dispatch an unconfirmed COD order above PKR 3,000, so nothing ships early.

Two backends behind one interface, because §2 says WhatsApp Business API "or
Twilio" and which one arrives first depends on approvals we do not control.

```bash
supabase secrets set \
  WHATSAPP_PROVIDER=meta \
  WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_ACCESS_TOKEN=... \
  WHATSAPP_TEMPLATE_NAME=order_confirmation \
  CRON_SECRET="$(openssl rand -hex 32)"
```

The template must be submitted to Meta and approved before first send — allow a
week (`HUMAN_TASKS.md`).

## `whatsapp-webhook`

Receives the customer's reply. Public by necessity, so:

- the request signature is verified against `WHATSAPP_APP_SECRET` with a
  constant-time compare — without it anyone could confirm, or cancel, anyone's
  order
- the order is identified by the token carried in the button payload, never by
  anything the sender says

```bash
supabase secrets set WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=...
```

## `dispatch-order`

Books confirmed orders with whichever courier we have an account with (§2:
"abstract behind one interface"). Adapters for TCS and Leopards are in
`_shared/courier/`; `COURIER` selects one.

The unconfirmed-COD gate lives in the database, not in this function — a rule
that matters this much should not depend on which path reached dispatch.

```bash
supabase secrets set COURIER=leopards \
  LEOPARDS_API_KEY=... LEOPARDS_API_PASSWORD=... COURIER_ORIGIN_CITY=Lahore
```

## `send-notifications`

Delivers the queued expiry and streak reminders through Expo Push. §4 calls the
expiry warning our single best reactivation lever: the user about to lose their
coins is exactly the user who finally has enough to want to spend them.

Queueing and sending are separate on purpose — a push outage delays a reminder
rather than losing it, and the unique key on (user, kind, dedupe_key) means a
retry cannot nag anyone twice. Tokens that come back `DeviceNotRegistered` are
dropped, because Expo rate-limits senders that keep pushing to uninstalled apps.

```bash
supabase functions deploy send-notifications
# then schedule it a few minutes after queue_expiry_warnings (see supabase/cron.sql)
```

## `verify-ad-reward`

AdMob's server-side verification callback. Google calls it once a rewarded video
is genuinely watched; it verifies the ECDSA signature against Google's published
keys and then mints.

It replaces a client-callable claim, which was worth 90 coins a day to anyone
willing to call it three times without watching anything — small per user, and
exactly the throughput a farm is built for. A forged or unverifiable callback
pays nothing and says nothing about why, for the same reason the step
attestation fails closed.

```bash
supabase functions deploy verify-ad-reward --no-verify-jwt
```

`--no-verify-jwt` because Google calls it, not a signed-in user. The signature
check is what authenticates the request.

Then in the AdMob console, set the rewarded ad unit's SSV URL to this function
and pass the user's id as `user_id` in the ad request's custom data.
