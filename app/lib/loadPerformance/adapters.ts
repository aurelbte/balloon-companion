import { enabledOfficialLoadDatasets } from "./manufacturerDatasets.ts";
import type {
  LoadCalculationInput,
  LoadCalculationResult,
  LoadSupportResult,
  ManufacturerLoadAdapter,
} from "./types.ts";

abstract class DisabledUntilVerifiedAdapter implements ManufacturerLoadAdapter {
  abstract readonly manufacturer: string;

  canCalculate(input: LoadCalculationInput): LoadSupportResult {
    if (input.manufacturer?.trim().localeCompare(this.manufacturer, undefined, { sensitivity: "base" }) !== 0) {
      return { supported: false, reasonCode: "UNSUPPORTED_MODEL", message: "Modèle constructeur non pris en charge." };
    }
    const dataset = enabledOfficialLoadDatasets.find(
      (item) => item.manufacturer === this.manufacturer
        && item.supportedModels.includes(input.model ?? "")
        && item.id === input.officialLoadDatasetId
        && item.manualRevision === input.officialManualRevision,
    );
    return dataset
      ? { supported: true, datasetId: dataset.id }
      : {
          supported: false,
          reasonCode: "UNSUPPORTED_OFFICIAL_DATASET",
          message: "Données constructeur non encore intégrées pour ce modèle.",
        };
  }

  calculate(input: LoadCalculationInput): LoadCalculationResult {
    const support = this.canCalculate(input);
    if (!support.supported) return { status: "UNAVAILABLE", reasonCode: support.reasonCode, message: support.message };
    return {
      status: "UNAVAILABLE",
      reasonCode: "UNSUPPORTED_OFFICIAL_DATASET",
      message: "Le dataset officiel activé ne possède pas encore d’adaptateur de calcul vérifié.",
    };
  }
}

export class CameronLoadAdapter extends DisabledUntilVerifiedAdapter { readonly manufacturer = "Cameron"; }
export class KubicekLoadAdapter extends DisabledUntilVerifiedAdapter { readonly manufacturer = "Kubíček"; }
export class UltramagicLoadAdapter extends DisabledUntilVerifiedAdapter { readonly manufacturer = "Ultramagic"; }

export const manufacturerLoadAdapters: readonly ManufacturerLoadAdapter[] = [
  new CameronLoadAdapter(),
  new KubicekLoadAdapter(),
  new UltramagicLoadAdapter(),
];
