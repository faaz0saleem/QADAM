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
