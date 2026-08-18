# Supabase local schema

The versioned migrations in `migrations/` define Balloon Companion cloud-sync metadata. They do not upload or migrate local application data.

Run the reproducible RLS suite against an isolated local Supabase database:

```sh
supabase start
supabase db reset
supabase test db
```

The test transaction creates two temporary Auth users and rolls every fixture back.

## Cloud sync mutation protocol V1

`public.apply_cloud_sync_mutation` is the authenticated transactional entry point for
the server protocol. Ownership always comes from `auth.uid()`; no client user ID is
accepted. The first synchronized creation has revision `0`, matching the local
initial revision. Every later successful UPSERT or soft DELETE increments the
revision by one.

The V1 RPC explicitly supports `profile`, `balloon`, `favorite_weather_place`, and
`flight` (plus documented spelling aliases). Payload fields are whitelisted per
domain, and flight Blob metadata is intentionally excluded pending a separate Blob
authorization/finalization protocol.

Successful mutations store a 90-day idempotency receipt. Replays return the original
revision as `ALREADY_APPLIED`; stale revisions and attempts to revive tombstones
return `CONFLICT`. Transaction-scoped advisory locks serialize both mutation IDs and
entity revisions, including creation races where no row exists yet.
