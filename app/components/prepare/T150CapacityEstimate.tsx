"use client";

import { useId, useState } from "react";
import type { BalloonWeights } from "../../lib/balloons";
import type { LoadCalculationInput } from "../../lib/loadPerformance/types";
import { fm04Compatibility } from "../../lib/loadPerformance/ultramagic/fm04Rules";
import { estimateT150RemainingCapacity, type T150CapacityConfiguration } from "../../lib/t150CapacityEstimate";

const fields = [
  ["basketPlateKg", "Maximum porté indiqué sur la plaque nacelle"],
  ["basketCarriedKg", "Masse réellement portée ou suspendue (hors nacelle vide)"],
  ["buildMtomKg", "MTOM du Build Standard"],
  ["buildLmaxKg", "Lmax du Build Standard"],
  ["baggageKg", "Bagages (0 si aucun)"],
  ["accessoriesKg", "Accessoires supplémentaires (0 si aucun)"],
  ["landingMassKg", "Masse totale prévue à l’atterrissage"],
] as const;
const kg = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Non disponible" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`;
const remainingKg = (value: number | null) => kg(value === null ? null : Math.floor(value));

export default function T150CapacityEstimate({ input, weights }: { input: LoadCalculationInput; weights: BalloonWeights }) {
  const id = useId();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState({ reducedMtomDocumented: false, equipmentRequirementsReviewed: false });
  const configuration: T150CapacityConfiguration = { ...checks, basketType: draft.basketType, burnerModel: draft.burnerModel };
  for (const [key] of fields) {
    const raw = draft[key]?.trim().replace(",", ".");
    configuration[key] = raw ? (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN) : undefined;
  }
  const estimate = estimateT150RemainingCapacity(input, weights, configuration);
  if (!estimate) return null;
  const compatible = fm04Compatibility("T150")!;
  return <section aria-labelledby={`${id}-title`} className="mt-4 space-y-3 border-t pt-3">
    <h3 id={`${id}-title`} className="font-semibold">T150 · capacité restante estimée</h3>
    <p className="text-xs">Saisies provisoires, non enregistrées. Relever les valeurs de votre appareil : plaque nacelle, Build Standard et pesée réelle. Les masses du profil incluent déjà cylindres et carburant ; ne pas les compter deux fois.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {([ ["basketType", "Nacelle", compatible.baskets], ["burnerModel", "Brûleur / assemblage", compatible.burners] ] as const).map(([key, label, options]) => <label key={key} className="min-w-0 text-xs">{label}<select value={draft[key] ?? ""} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base"><option value="">À renseigner</option>{options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>)}
      {fields.map(([key, label]) => <label key={key} className="min-w-0 text-xs">{label} (kg)<input type="text" inputMode="decimal" value={draft[key] ?? ""} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>)}
    </div>
    {([ ["equipmentRequirementsReviewed", "FDS, évents de rotation, équipements et suppléments vérifiés selon le Build Standard (minimum deux cylindres)."], ["reducedMtomDocumented", "Si MTOM réduite : approbation inscrite au carnet par un inspecteur qualifié."] ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-3 text-xs"><input type="checkbox" checked={checks[key]} onChange={event => setChecks(current => ({ ...current, [key]: event.target.checked }))} className="h-5 w-5 shrink-0" />{label}</label>)}
    <dl className="space-y-1 text-xs">
      {[["Portance théorique", estimate.theoreticalLiftKg], ["Enveloppe réelle", weights.envelopeKg], ["Nacelle vide réelle", weights.basketKg], ["Brûleur réel", weights.burnerKg], ...weights.fullCylinders.map((cylinder, index) => [`Cylindre ${index + 1}, carburant compris`, cylinder.fullWeightKg]), ["Ballon équipé, cylindres et carburant compris", input.balloonEquipmentWeightKg], ["Pilote et passagers", input.occupantsWeightKg], ["Masse totale réelle au décollage", estimate.actualTotalMassKg], ["MTOM applicable du profil", input.applicableMtowKg], ["Minimum TOM (départ et atterrissage)", estimate.minimumTomKg]].map(([label, value]) => <div key={String(label)} className="flex flex-wrap justify-between gap-x-3"><dt>{label}</dt><dd>{kg(value as number | null | undefined)}</dd></div>)}
    </dl>
    <p role="status" className="font-semibold">Estimation non validée · capacité restante : {remainingKg(estimate.remainingKg)}</p>
    {estimate.remainingKg !== null && <><p className="text-xs">{estimate.remainingKg < 0 ? "Dépassement estimé" : "Masse supplémentaire estimée pouvant être ajoutée dans la nacelle"} · limite : {estimate.limitingConstraint}.</p><dl className="text-xs">{estimate.headrooms.map(row => <div key={row.label} className="flex flex-wrap justify-between gap-x-3"><dt>Reliquat · {row.label}</dt><dd>{remainingKg(row.remainingKg)}</dd></div>)}</dl></>}
    {estimate.issues.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs">{estimate.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <p className="text-xs">METHOD_NOT_VALIDATED maintenu : méthode sans validation indépendante, aucune charge admissible validée. FM04 section 5, p.5.3–5.6 et 5.8–5.9 ; minimum à l’atterrissage p.2.3. Les pesées indicatives du manuel ne remplacent pas celles de votre appareil.</p>
  </section>;
}
