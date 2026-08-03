import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureDirectory, manualsRoot, readManualAudit, sha256 } from "./shared.mjs";

await ensureDirectory(manualsRoot);
const audit = await readManualAudit();
for (const document of audit.documents) {
  const response = await fetch(document.sourceUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`${document.id}: téléchargement HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const checksum = sha256(bytes);
  if (checksum !== document.checksumSha256) throw new Error(`${document.id}: checksum inattendu (${checksum})`);
  await writeFile(resolve(manualsRoot, document.localFilename), bytes);
  console.log(`${document.id}: téléchargé et vérifié (${checksum})`);
}
