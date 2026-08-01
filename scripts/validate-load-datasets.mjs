import { officialLoadDatasets, validateOfficialLoadDatasets } from "../app/lib/loadPerformance/manufacturerDatasets.ts";

const errors = validateOfficialLoadDatasets(officialLoadDatasets);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${officialLoadDatasets.length} datasets audités, ${officialLoadDatasets.filter(({ enabled }) => enabled).length} activé(s).`);
}
