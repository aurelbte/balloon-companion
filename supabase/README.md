# Supabase local schema

The versioned migrations in `migrations/` define Balloon Companion cloud-sync metadata. They do not upload or migrate local application data.

Run the reproducible RLS suite against an isolated local Supabase database:

```sh
supabase start
supabase db reset
supabase test db
```

The test transaction creates two temporary Auth users and rolls every fixture back.
