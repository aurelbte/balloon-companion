import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureDirectory, generatedRoot, readManualAudit } from "./shared.mjs";

await ensureDirectory(generatedRoot);
const audit = await readManualAudit();
const report = {
  generatedAt: new Date().toISOString(),
  status: "PENDING_HUMAN_VERIFICATION",
  documents: audit.documents.map(({ id, checksumSha256, pagesUsed }) => ({ id, checksumSha256, pagesUsed })),
  warning: "Ce rapport ne doit pas être activé ni copié dans un dataset officiel sans revue humaine des extractions.",
};
const destination = resolve(generatedRoot, "generation-report.json");
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Rapport de génération prudente : ${destination}`);
