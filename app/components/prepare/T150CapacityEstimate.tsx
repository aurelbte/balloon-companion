"use client";

import { useId } from "react";
import type { BalloonWeights } from "../../lib/balloons";
import type { LoadCalculationInput } from "../../lib/loadPerformance/types";
import { estimateT150RemainingCapacity } from "../../lib/t150CapacityEstimate";

const kg = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "Non disponible" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`;
const marginKg = (value: number | null) => kg(value === null ? null : Math.floor(value));

export default function T150CapacityEstimate({ input, weights }: { input: LoadCalculationInput; weights: BalloonWeights }) {
  const id = useId();
  const estimate = estimateT150RemainingCapacity(input, weights);
  if (!estimate) return null;
  return <section aria-labelledby={`${id}-title`} className="mt-4 space-y-3 border-t pt-3">
    <h3 id={`${id}-title`} className="font-semibold">T150 · marge estimée</h3>
    <p role="status" className="text-lg font-semibold">{marginKg(estimate.remainingKg)} · estimation non validée</p>
    {estimate.remainingKg !== null && <p className="text-xs">{estimate.remainingKg < 0 ? "Dépassement estimé" : "Marge estimée"} · limite : {estimate.limitingConstraint}.</p>}
    <p className="text-xs">Minimum entre portance théorique et MTOM applicable, moins le ballon équipé et les occupants. Masses et cylindres repris de « Mes ballons », sans restriction de marque. Vérifiez que les cylindres pleins enregistrés correspondent au vol ; carburant compté une seule fois. Bagages et accessoires supplémentaires non inclus.</p>
    <p className="text-xs font-semibold">METHOD_NOT_VALIDATED · aucune charge admissible certifiée. Cette marge ne constitue pas une autorisation d’ajouter cette masse à bord.</p>
    <ul className="list-disc space-y-1 pl-4 text-xs">{estimate.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    {estimate.issues.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs">{estimate.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    <details className="text-xs">
      <summary className="flex min-h-11 cursor-pointer items-center">Masses et contrôles T150</summary>
      <dl className="space-y-1">
        {[["Portance théorique", estimate.theoreticalLiftKg], ["Enveloppe réelle", weights.envelopeKg], ["Nacelle vide réelle", weights.basketKg], ["Brûleur réel", weights.burnerKg], ...weights.fullCylinders.map((cylinder, index) => [`${cylinder.label || `Cylindre ${index + 1}`}, carburant compris`, cylinder.fullWeightKg]), ["Ballon équipé, cylindres et carburant compris", input.balloonEquipmentWeightKg], ["Pilote et passagers", input.occupantsWeightKg], ["Masse prise en compte", estimate.actualTotalMassKg], ["MTOM applicable du profil", input.applicableMtowKg], ["Minimum TOM (départ et atterrissage)", estimate.minimumTomKg]].map(([label, value], index) => <div key={index} className="flex flex-wrap justify-between gap-x-3"><dt>{label}</dt><dd>{kg(value as number | null | undefined)}</dd></div>)}
        {estimate.headrooms.map(row => <div key={row.label} className="flex flex-wrap justify-between gap-x-3"><dt>Écart · {row.label}</dt><dd>{marginKg(row.remainingKg)}</dd></div>)}
      </dl>
      <p className="mt-2">Compatibilité réglementaire non établie. FM04 section 5, p.5.3–5.6 et 5.8–5.9 ; minimum à l’atterrissage p.2.3. Méthode sans validation indépendante ; les pesées indicatives ne remplacent pas celles de votre appareil.</p>
    </details>
  </section>;
}
