-- Provider discriminator for the temporary Supabase Storage -> Cloudflare R2 transition.
do $$ begin
  alter table public.flights add constraint flights_storage_provider_check
    check (storage_provider is null or storage_provider in ('SUPABASE_STORAGE', 'R2'));
exception when duplicate_object then null;
end $$;

create index if not exists flights_track_provider_status_idx
  on public.flights (user_id, storage_provider, blob_status)
  where object_key is not null;

