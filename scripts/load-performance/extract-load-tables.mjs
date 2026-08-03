import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureDirectory, extractedRoot, manualsRoot, readManualAudit } from "./shared.mjs";

const probe = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
if (probe.error?.code === "ENOENT") throw new Error("pdftotext (Poppler) est requis pour l'extraction fidèle des PDF.");
await ensureDirectory(extractedRoot);
const audit = await readManualAudit();
for (const document of audit.documents) {
  const source = resolve(manualsRoot, document.localFilename);
  await access(source);
  const destination = resolve(extractedRoot, `${document.id}.txt`);
  const extraction = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", source, destination], { encoding: "utf8" });
  if (extraction.status !== 0) throw new Error(`${document.id}: extraction impossible\n${extraction.stderr}`);
  console.log(`${document.id}: texte extrait vers ${destination}`);
}
