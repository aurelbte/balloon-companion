import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const workRoot = resolve(repositoryRoot, ".load-performance-work");
export const manualsRoot = resolve(workRoot, "manuals");
export const extractedRoot = resolve(workRoot, "extracted");
export const generatedRoot = resolve(workRoot, "generated");
export const auditPath = resolve(repositoryRoot, "app/lib/loadPerformance/datasets/audits/official-manuals.json");

export async function readManualAudit() {
  return JSON.parse(await readFile(auditPath, "utf8"));
}

export async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
