"use client";

import { useId, useState } from "react";
import type { BalloonWeights } from "../../lib/balloons";
import type { LoadCalculationInput } from "../../lib/loadPerformance/types";
import { estimateT150RemainingCapacity, type T150CapacityConfiguration } from "../../lib/t150CapacityEstimate";

const fields = [
  ["baggageKg", "Bagages (0 si aucun)"],
  ["accessoriesKg", "Accessoires supplémentaires (0 si aucun)"],
  ["landingMassKg", "Masse totale prévue à l’atterrissage"],
] as const;
const kg = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Non disponible" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`;
const remainingKg = (value: number | null) => kg(value === null ? null : Math.floor(value));

export default function T150CapacityEstimate({ input, weights }: { input: LoadCalculationInput; weights: BalloonWeights }) {
  const id = useId();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const configuration: T150CapacityConfiguration = {};
  for (const [key] of fields) {
    const raw = draft[key]?.trim().replace(",", ".");
    configuration[key] = raw ? (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN) : undefined;
  }
  const estimate = estimateT150RemainingCapacity(input, weights, configuration);
  if (!estimate) return null;
  return <section aria-labelledby={`${id}-title`} className="mt-4 space-y-3 border-t pt-3">
    <h3 id={`${id}-title`} className="font-semibold">T150 · capacité restante estimée</h3>
    <p className="text-xs">Masses et cylindres repris de « Mes ballons », sans restriction de marque. Les marques et modèles individuels ne sont pas enregistrés dans le profil actuel ; aucune compatibilité n’est déduite. Vérifiez que les cylindres pleins enregistrés correspondent au vol.</p>
    <p className="text-xs">Saisies propres à ce vol, non enregistrées : renseignez uniquement les bagages et accessoires supplémentaires, absents des masses du profil (0 si aucun). Cylindres et carburant sont déjà comptés.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map(([key, label]) => <label key={key} className="min-w-0 text-xs">{label} (kg)<input type="text" inputMode="decimal" value={draft[key] ?? ""} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border bg-[var(--bc-surface)] px-2 text-base" /></label>)}
    </div>
    <dl className="space-y-1 text-xs">
      {[["Portance théorique", estimate.theoreticalLiftKg], ["Enveloppe réelle", weights.envelopeKg], ["Nacelle vide réelle", weights.basketKg], ["Brûleur réel", weights.burnerKg], ...weights.fullCylinders.map((cylinder, index) => [`${cylinder.label || `Cylindre ${index + 1}`}, carburant compris`, cylinder.fullWeightKg]), ["Ballon équipé, cylindres et carburant compris", input.balloonEquipmentWeightKg], ["Pilote et passagers", input.occupantsWeightKg], ["Masse totale réelle au décollage", estimate.actualTotalMassKg], ["MTOM applicable du profil", input.applicableMtowKg], ["Minimum TOM (départ et atterrissage)", estimate.minimumTomKg]].map(([label, value]) => <div key={String(label)} className="flex flex-wrap justify-between gap-x-3"><dt>{label}</dt><dd>{kg(value as number | null | undefined)}</dd></div>)}
    </dl>
    <p role="status" className="font-semibold">Estimation non validée · reliquat des limites disponibles : {remainingKg(estimate.remainingKg)}</p>
    {estimate.remainingKg !== null && <><p className="text-xs">{estimate.remainingKg < 0 ? "Dépassement estimé" : "Reliquat estimé selon les seules limites disponibles, hors limites non documentées"} · limite : {estimate.limitingConstraint}.</p><dl className="text-xs">{estimate.headrooms.map(row => <div key={row.label} className="flex flex-wrap justify-between gap-x-3"><dt>Reliquat · {row.label}</dt><dd>{remainingKg(row.remainingKg)}</dd></div>)}</dl></>}
    <p className="text-xs font-semibold">Ce reliquat ne constitue pas une autorisation d’ajouter cette masse à bord.</p>
    <ul className="list-disc space-y-1 pl-4 text-xs">{estimate.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    {estimate.issues.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs">{estimate.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <p className="text-xs">METHOD_NOT_VALIDATED maintenu : méthode sans validation indépendante, aucune charge admissible validée. FM04 section 5, p.5.3–5.6 et 5.8–5.9 ; minimum à l’atterrissage p.2.3. Les pesées indicatives du manuel ne remplacent pas celles de votre appareil.</p>
  </section>;
}
