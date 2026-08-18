import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/migrations/20260818120000_cloud_sync_schema.sql", import.meta.url), "utf8");
const rls = readFileSync(new URL("../../supabase/tests/cloud_sync_rls.test.sql", import.meta.url), "utf8");

const tables = [
  "profiles", "balloons", "favorite_launch_sites", "favorite_weather_places",
  "aviation_preferences", "user_preferences", "flights", "logbook_entries",
  "documents", "sync_devices", "sync_idempotency",
];

test("la migration crée uniquement les tables cloud V1 attendues", () => {
  for (const table of tables) assert.match(migration, new RegExp(`create table public\\.${table} \\(`));
  assert.doesNotMatch(migration, /create table public\.flight_(points|trace)|\bbytea\b/i);
});

test("toutes les tables privées sont incluses dans l'activation RLS stricte", () => {
  for (const table of tables) assert.match(migration, new RegExp(`'${table}'`));
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /for insert to authenticated with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /for update to authenticated using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /for delete to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /revoke all on public\.%I from anon/);
});

test("les relations enfants incluent user_id dans leurs clés étrangères", () => {
  assert.match(migration, /foreign key \(user_id, balloon_id\) references public\.balloons\(user_id, id\)/);
  assert.match(migration, /foreign key \(user_id, flight_id\) references public\.flights\(user_id, id\)/);
});

test("révisions et horodatages sont imposés par des triggers serveur", () => {
  assert.match(migration, /new\.revision := 0/);
  assert.match(migration, /new\.revision := old\.revision \+ 1/);
  assert.match(migration, /new\.created_at := statement_timestamp\(\)/);
  assert.match(migration, /new\.updated_at := statement_timestamp\(\)/);
  assert.match(migration, /deleted_at timestamptz/g);
});

test("les métadonnées blob sont neutres et aucun fournisseur n'est codé en dur", () => {
  for (const field of ["storage_provider", "object_key", "format_version", "checksum", "blob_status", "blob_size"]) assert.match(migration, new RegExp(field));
  assert.doesNotMatch(migration, /cloudflare|\br2\b|supabase storage/i);
});

test("le scénario pgTAP couvre l'isolation et la relation document-ballon", () => {
  assert.match(rls, /USER A lit uniquement ses ballons/);
  assert.match(rls, /USER A ne lit pas USER B/);
  assert.match(rls, /USER A ne modifie pas USER B/);
  assert.match(rls, /USER A ne supprime pas USER B/);
  assert.match(rls, /USER A ne peut pas insérer avec user_id USER B/);
  assert.match(rls, /document USER A ne peut pas référencer un ballon USER B/);
  assert.match(rls, /select plan\(21\)/);
  assert.match(rls, /rollback;/);
});

test("aucune clé privilégiée ni endpoint n'est introduit", () => {
  const sources = `${migration}\n${rls}`;
  assert.doesNotMatch(sources, /service_role|secretAccessKey|NEXT_PUBLIC|https?:\/\//i);
});
