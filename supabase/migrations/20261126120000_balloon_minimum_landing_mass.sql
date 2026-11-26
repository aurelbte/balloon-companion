-- Optional MLM metadata lives inside the existing weights JSONB object.
-- Old clients omit this member: preserve its value/reference. Explicit JSON null clears it.
-- No backfill, inferred values, RLS changes or alteration of the sync protocol.
create or replace function public.preserve_balloon_minimum_landing_mass()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  configuration_changed boolean;
  minimum_mass jsonb;
begin
  -- Do not sanitize invalid input into an apparently complete configuration.
  -- Existing NOT NULL / object CHECK constraints reject SQL NULL, JSON null,
  -- arrays and scalars, without jsonb_set raising an unrelated scalar error.
  if pg_catalog.jsonb_typeof(new.weights) is distinct from 'object' then
    return new;
  end if;

  if old.weights ? 'minimumLandingMass' and not (new.weights ? 'minimumLandingMass') then
    new.weights := pg_catalog.jsonb_set(new.weights, '{minimumLandingMass}', old.weights->'minimumLandingMass');
  end if;

  configuration_changed :=
    row(old.registration, old.manufacturer, old.model, old.category, old.volume_m3, old.applicable_mtom_kg)
      is distinct from
    row(new.registration, new.manufacturer, new.model, new.category, new.volume_m3, new.applicable_mtom_kg)
    or (old.weights - 'minimumLandingMass') is distinct from (new.weights - 'minimumLandingMass');
  minimum_mass := new.weights->'minimumLandingMass';

  -- A preserved/echoed review cannot validate a changed aircraft. Keep its value
  -- and documentary reference, but remove the stale confirmation and binding.
  -- A new client may explicitly submit a renewed review with a NEW, nonempty
  -- configuration binding in the same update. Its documentary applicability is
  -- still validated by the application: this trigger never certifies a manual.
  if configuration_changed and pg_catalog.jsonb_typeof(minimum_mass) = 'object'
    and minimum_mass->'confirmed' = 'true'::jsonb
    and (coalesce(pg_catalog.btrim(minimum_mass->>'confirmationKey'), '') = ''
      or minimum_mass->>'confirmationKey' is not distinct from old.weights->'minimumLandingMass'->>'confirmationKey') then
    new.weights := pg_catalog.jsonb_set(new.weights, '{minimumLandingMass}',
      pg_catalog.jsonb_set(minimum_mass - 'confirmationKey', '{confirmed}', 'false'::jsonb));
  end if;
  return new;
end;
$$;
drop trigger if exists preserve_balloon_minimum_landing_mass on public.balloons;
create trigger preserve_balloon_minimum_landing_mass
before update on public.balloons
for each row execute function public.preserve_balloon_minimum_landing_mass();

revoke execute on function public.preserve_balloon_minimum_landing_mass() from public, anon, authenticated;
