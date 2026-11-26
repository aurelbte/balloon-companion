import { balloonMinimumLandingMass } from "./balloonMinimumLandingMass.ts";
import type { Balloon } from "./balloons.ts";
import { MOROCCO_LANDING_MASS_RULES, type MoroccoLandingMassRule } from "./moroccoMinimumLandingMassData.ts";

const normalized = (value: unknown) => typeof value === "string" ? value.replace(/[ -]/g, "").toUpperCase() : "";

/** Explicit reviewed applicability, never inferred from a filename, MTOM confirmation or load-method status.
 * Legacy preparation evidence remains supported; reviewed profile metadata takes priority.
 * An unconfirmed documentary proposal is displayed independently from an applicable limit.
 */
export type MoroccoLandingMassApplicability = Readonly<{
  manualSha256: string;
  variant: string;
  balloonConfigurationKey: string;
  configurationReference: string;
  manualApplicabilityConfirmed: boolean;
  normalOperation: boolean;
  supplementsReview: "NO_MLM_OVERRIDE" | "UNREVIEWED" | "MLM_OVERRIDE";
  documentaryRuleKey: string;
}>;

export const moroccoLandingMassRuleKey = (rule: MoroccoLandingMassRule): string => JSON.stringify(rule);
export function moroccoLandingMassRulesForBalloon(balloon: Balloon) {
  return MOROCCO_LANDING_MASS_RULES.filter(p => normalized(p.manufacturer) === normalized(balloon.manufacturer) && normalized(p.model) === normalized(balloon.model));
}

/** Bind a review to the selected aircraft/profile; changed equipment/masses invalidate that review. */
export function moroccoLandingMassConfigurationKey(balloon: Balloon): string {
  return JSON.stringify([balloon.id, balloon.registration, normalized(balloon.manufacturer), normalized(balloon.model), balloon.volumeM3,
    balloon.applicableMtowKg ?? null, balloon.weights.envelopeKg ?? null, balloon.weights.basketKg ?? null, balloon.weights.burnerKg ?? null,
    [...balloon.weights.fullCylinders].sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id, c.label ?? "", c.fullWeightKg])]);
}

/** Presentation only: never derive a minimum from MTOM/lift/planned mass or activate a load method. */
export function moroccoMinimumLandingMass(balloon: Balloon, applicability?: MoroccoLandingMassApplicability) {
  const profile = balloonMinimumLandingMass(balloon);
  if (balloon.minimumLandingMass || profile.confirmed) return { kg: profile.confirmed ? profile.valueKg : null, displayKg: profile.valueKg, confirmed: profile.confirmed, source: profile.source, notice: profile.notice };
  const matches = moroccoLandingMassRulesForBalloon(balloon);
  const candidates = matches.filter(p => p.source.sha256 === applicability?.manualSha256 && normalized(p.variant) === normalized(applicability?.variant ?? ""));
  const p = candidates.length === 1 ? candidates[0] : undefined;
  const source = (p ? [p] : matches).map(p => `${p.source.file} ; ${p.source.edition} ; §${p.source.sections} ; pages ${p.source.pages.join(", ")} (PDF ${p.source.pdfPages.join(", ")})`).join(" / ") || null;
  const missing: string[] = [];
  if (!p) missing.push("édition du manuel applicable et variante non attestées ou non documentées");
  if (p && applicability?.documentaryRuleKey !== moroccoLandingMassRuleKey(p)) missing.push("référence documentaire modifiée ou confirmation ancienne non liée à cette référence");
  if (p && p.volumeM3 !== balloon.volumeM3) missing.push("volume différent de la variante documentée");
  if (applicability?.manualApplicabilityConfirmed !== true) missing.push("applicabilité du manuel non confirmée");
  if (applicability?.balloonConfigurationKey !== moroccoLandingMassConfigurationKey(balloon) || typeof applicability?.configurationReference !== "string" || !applicability.configurationReference.trim()) missing.push("configuration et référence approuvée non attestées");
  if (applicability?.supplementsReview !== "NO_MLM_OVERRIDE") missing.push("suppléments ou données approuvées non vérifiés ou modifiant la MLM");
  if (applicability?.normalOperation !== true) missing.push("exploitation normale non confirmée");
  return p && !missing.length ? { kg: p.value, displayKg: p.value, confirmed: true, source, notice: `MLM documentée : ${p.value} ${p.unit}. Configuration vérifiée : ${applicability!.configurationReference}. ${p.conditions.join(" ")} Aucun recalcul ni validation du moteur de charge.` }
    : { kg: null, displayKg: profile.valueKg, confirmed: false, source: profile.source ?? source, notice: profile.valueKg !== null ? profile.notice : `À vérifier dans le manuel de vol. ${matches.length ? "Une MLM documentaire existe ; " : "Aucune MLM documentée pour ce modèle exact ; "}${missing.join(" ; ")}.` };
}
