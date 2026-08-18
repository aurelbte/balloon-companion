import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../supabase/migrations/20260818130000_cloud_sync_mutation_protocol.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../supabase/migrations/20260818120000_cloud_sync_schema.sql", import.meta.url), "utf8");
const pgTap = readFileSync(new URL("../../supabase/tests/cloud_sync_mutation_protocol.test.sql", import.meta.url), "utf8");

test("la RPC 2B est authentifiée, atomique et sans autorité userId cliente", () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /uuid := auth\.uid\(\)/);
  assert.doesNotMatch(migration, /p_user_id/i);
  assert.match(migration, /revoke all on function .* from public, anon/i);
  assert.match(migration, /grant execute on function .* to authenticated/i);
  assert.match(migration, /pg_advisory_xact_lock/g);
});

test("le protocole expose les quatre résultats déterministes", () => {
  for (const status of ["APPLIED", "ALREADY_APPLIED", "CONFLICT", "NOT_FOUND"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  for (const field of ["result_revision", "server_updated_at", "result_deleted_at", "expires_at"]) {
    assert.match(`${schema}\n${migration}`, new RegExp(field));
  }
});

test("les domaines prioritaires utilisent un mapping explicite et des whitelists", () => {
  for (const entity of ["profile", "balloon", "favorite_weather_place", "flight"]) {
    assert.match(migration, new RegExp(`'${entity}'`));
  }
  for (const protectedField of ["user_id", "revision", "created_at", "updated_at", "deleted_at", "storage_provider", "object_key", "checksum", "blob_status"]) {
    assert.doesNotMatch(migration, new RegExp(`array\\[[^\\]]*'${protectedField}'`));
  }
  assert.doesNotMatch(migration, /execute\s+format|execute\s+p_entity_type/i);
});

test("le scénario pgTAP couvre idempotence, conflit, suppression, isolation et concurrence", () => {
  for (const marker of [
    "CREATE baseRevision 0", "ALREADY_APPLIED", "revision périmée", "soft delete",
    "ne ressuscite pas", "NOT_FOUND", "même mutationId", "USER A", "même revision",
  ]) assert.match(pgTap, new RegExp(marker));
  assert.match(pgTap, /select plan\(30\)/);
  assert.match(pgTap, /rollback;/);
});

test("la phase 2B n'ajoute aucun accès réseau ou secret client", () => {
  const sources = `${migration}\n${pgTap}`;
  assert.doesNotMatch(sources, /service_role|NEXT_PUBLIC|https?:\/\//i);
});
