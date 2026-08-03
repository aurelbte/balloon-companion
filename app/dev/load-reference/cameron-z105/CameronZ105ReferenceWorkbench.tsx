"use client";

import { useMemo, useState } from "react";
import {
  CAMERON_Z105_REFERENCE_001,
  applyApplicableMtowLimit,
  validateCameronZ105Reference,
  type CameronZ105ReferenceCase,
} from "../../../lib/loadPerformance/referenceCases/cameronZ105References";
import { calculateOfficialLoad } from "../../../lib/loadPerformance/engine";
import { calculateCameronOfficialCandidate } from "../../../lib/loadPerformance/cameron/officialCalculation";
import styles from "./page.module.css";

const STORAGE_KEY = "balloon-companion-dev-cameron-z105-references";
const fields: readonly [keyof CameronZ105ReferenceCase, string][] = [
  ["volumeM3", "Volume (m³)"], ["applicableMtowKg", "MTOM applicable (kg)"],
  ["balloonEquipmentWeightKg", "Masse équipée (kg)"], ["occupantsWeightKg", "Pilote + passagers (kg)"],
  ["launchElevationMslM", "Altitude terrain (m AMSL)"], ["plannedMaximumAltitudeMslM", "Altitude maximale (m AMSL)"],
  ["groundTemperatureC", "Température sol (°C)"], ["expectedOccupantsCapacityKg", "Capacité occupants attendue (kg)"],
  ["expectedMarginKg", "Marge attendue (kg)"], ["expectedPermittedTotalMassKg", "Masse totale permise attendue (kg)"],
];

export default function CameronZ105ReferenceWorkbench() {
  const [draft, setDraft] = useState<CameronZ105ReferenceCase>({ ...CAMERON_Z105_REFERENCE_001, id: `${CAMERON_Z105_REFERENCE_001.id}_DRAFT` });
  const [saved, setSaved] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const validation = useMemo(() => validateCameronZ105Reference(draft), [draft]);
  const balance = useMemo(() => applyApplicableMtowLimit({
    tablePermittedTotalMassKg: draft.expectedPermittedTotalMassKg,
    applicableMtowKg: draft.applicableMtowKg,
    balloonEquipmentWeightKg: draft.balloonEquipmentWeightKg,
    occupantsWeightKg: draft.occupantsWeightKg,
  }), [draft]);
  const official = useMemo(() => calculateOfficialLoad({
    balloonId: "DEV-REFERENCE", manufacturer: draft.manufacturer, model: draft.model, volumeM3: draft.volumeM3,
    applicableMtowKg: draft.applicableMtowKg, balloonEquipmentWeightKg: draft.balloonEquipmentWeightKg,
    occupantsWeightKg: draft.occupantsWeightKg, launchElevationMslM: draft.launchElevationMslM,
    plannedMaximumAltitudeMslM: draft.plannedMaximumAltitudeMslM,
    groundTemperature: { temperatureC: draft.groundTemperatureC, sourceModel: "Référence pilote", forecastRun: draft.verifiedAt, validTime: draft.verifiedAt },
  }), [draft]);
  const candidate = useMemo(() => calculateCameronOfficialCandidate({
    balloonId: "DEV-REFERENCE", manufacturer: draft.manufacturer, model: draft.model, volumeM3: draft.volumeM3,
    applicableMtowKg: draft.applicableMtowKg, balloonEquipmentWeightKg: draft.balloonEquipmentWeightKg,
    occupantsWeightKg: draft.occupantsWeightKg, launchElevationMslM: draft.launchElevationMslM,
    plannedMaximumAltitudeMslM: draft.plannedMaximumAltitudeMslM,
    groundTemperature: { temperatureC: draft.groundTemperatureC, sourceModel: "Référence pilote", forecastRun: draft.verifiedAt, validTime: draft.verifiedAt },
  }), [draft]);

  const saveDraft = () => {
    if (!validation.coherent) return;
    const current = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    const records = Array.isArray(current) ? current : [];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...records, { ...draft, savedAt: new Date().toISOString() }]));
    setSaved(true);
    setSavedCount(records.length + 1);
    setDraft((current) => ({ ...current, id: `CAMERON_Z105_REFERENCE_DRAFT_${records.length + 2}` }));
  };

  return <main className={styles.page}>
    <header><p>BANC DE RÉFÉRENCE · DÉVELOPPEMENT</p><h1>Cameron Z105</h1><span>Ces saisies ne constituent pas un dataset officiel.</span></header>
    <section className={styles.results}><h2>Plan de collecte</h2><p>Recopier des cas froids, tempérés et chauds, à plusieurs altitudes terrain et maximales, avec marges confortable, faible, nulle, dépassée et limitée par la MTOM.</p><small>{savedCount} brouillon(s) enregistré(s) dans ce navigateur · 15 références vérifiées restent requises avant activation.</small></section>
    <section className={styles.grid}>
      <label><span>Identifiant de référence</span><input value={draft.id} onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))} /></label>
      <label><span>Référence ou capture officielle</span><input value={draft.sourceDescription} onChange={(event) => setDraft((current) => ({ ...current, sourceDescription: event.target.value }))} /></label>
      {fields.map(([key, label]) => <label key={key}><span>{label}</span><input type="number" inputMode="decimal" value={String(draft[key])} onChange={(event) => setDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
    </section>
    <section className={styles.results}>
      <h2>Cohérence</h2>
      <dl><div><dt>Masse réelle recalculée</dt><dd>{validation.actualTotalMassKg} kg</dd></div><div><dt>Masse permise recalculée</dt><dd>{validation.permittedTotalMassFromCapacityKg} kg</dd></div><div><dt>Marge par capacité</dt><dd>{validation.marginFromCapacityKg} kg</dd></div><div><dt>Marge par totaux</dt><dd>{validation.marginFromTotalsKg} kg</dd></div><div><dt>Limite appliquée</dt><dd>{balance.limitingRule === "APPLICABLE_MTOW" ? "MTOM" : "Conditions de charge"}</dd></div></dl>
      <p className={validation.coherent ? styles.ok : styles.error}>{validation.coherent ? "Cas cohérent" : validation.errors.join(" ")}</p>
    </section>
    <section className={styles.results}><h2>Comparateur officiel</h2><p>Candidat documenté : {candidate ? `${Math.floor(candidate.marginKg)} kg` : "hors domaine"}</p><p>Application : {official.status === "AVAILABLE" ? `${official.marginKg} kg` : `Indisponible — ${official.message}`}</p><small>Le candidat sert à la comparaison. L’adaptateur utilisateur reste désactivé jusqu’à validation complète.</small></section>
    <button type="button" disabled={!validation.coherent} onClick={saveDraft}>Enregistrer ce brouillon local</button>
    {saved && <p className={styles.ok}>Brouillon enregistré localement pour revue et intégration manuelle.</p>}
  </main>;
}
