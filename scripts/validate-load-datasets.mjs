import { officialLoadDatasets, validateOfficialLoadDatasets } from "../app/lib/loadPerformance/manufacturerDatasets.ts";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const loadPerformanceRoot = fileURLToPath(new URL("../app/lib/loadPerformance/", import.meta.url));
const forbiddenArchitectureTerms = ["temperature" + "Profile", "limiting" + "TemperatureC", "Load" + "WeatherProvider"];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const errors = validateOfficialLoadDatasets(officialLoadDatasets);
for (const file of sourceFiles(loadPerformanceRoot)) {
  const source = readFileSync(file, "utf8");
  for (const term of forbiddenArchitectureTerms) {
    if (source.includes(term)) errors.push(`${file}: terme d’architecture interdit détecté (${term})`);
  }
}
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${officialLoadDatasets.length} datasets audités, ${officialLoadDatasets.filter(({ enabled }) => enabled).length} activé(s).`);
}
