# Edge Functions

Deployed with `supabase functions deploy <name>`. All five hold the service role
key, which is why none of them are reachable without either a caller JWT or a
verified third-party signature.

| Function | Trigger | What it guards |
|---|---|---|
| `attest-nonce` | client, authenticated | Issues a single-use 5-minute nonce so an attestation token cannot be captured and replayed. |
| `ingest-steps` | client, authenticated | The **only** way step data enters the system. Verifies Play Integrity / App Attest, then calls `submit_steps` as `service_role`. The device cannot reach that RPC — it is revoked from `authenticated`. |
| `admob-ssv` | Google, public | Verifies AdMob's ECDSA signature against Google's published verifier keys before crediting. The reward amount in Google's callback is ignored; coins come from `app_config`. |
| `expire-coins-notify` | pg_cron, 10:00 PKT | §4's reactivation lever: coins lapsing inside seven days. |
| `streak-notify` | pg_cron, 20:00 PKT | Streak at risk, while there is still an evening to walk in. |

## Attestation fails closed

`_shared/attest.ts` returns `false` on every path that has not positively
verified something — missing credentials, unreachable Google, malformed token,
unexpected verdict. An attestation layer that defaults to *pass* when
misconfigured is worse than none, because it looks like it is working.

**iOS App Attest is not implemented yet, so iOS submissions currently earn
nothing.** That is the correct failure direction, and it is a P1 in
`HUMAN_TASKS.md` rather than a quiet TODO. The comment in `attest.ts` lists the
five steps the real implementation needs; the counter check in step 5 is what
actually stops replay, so it lands with the rest or not at all.

## Environment

Set with `supabase secrets set`. None of these may ever be prefixed
`EXPO_PUBLIC_` — Expo inlines those into the shipped bundle.

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   (provided by the platform)
ANDROID_PACKAGE_NAME              e.g. com.qadam.app
GOOGLE_SERVICE_ACCOUNT_JSON       service account with the playintegrity scope
APPLE_APP_ATTEST_TEAM_ID
APPLE_APP_ATTEST_BUNDLE_ID
EXPO_ACCESS_TOKEN                 optional; raises Expo's push rate limits
```

`private.notify()` needs two database settings so cron can reach these:

```sql
alter database postgres set app.functions_base_url = 'https://<ref>.supabase.co/functions/v1';
alter database postgres set app.service_role_key   = '<service role key>';
```
