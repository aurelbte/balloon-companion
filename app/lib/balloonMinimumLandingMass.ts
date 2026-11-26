import type { Balloon } from "./balloons.ts";
import { MOROCCO_LANDING_MASS_RULES, type MoroccoLandingMassRule } from "./moroccoMinimumLandingMassData.ts";

export type BalloonMinimumLandingMass = Readonly<{
  valueKg: number; modelKey: string; ruleKey: string; reference: string;
  confirmed: boolean; confirmationKey?: string;
}>;
const normalized = (value: string) => value.replace(/[ -]/g, "").toUpperCase();
export const balloonMlmModelKey = (balloon: Pick<Balloon, "manufacturer" | "model" | "volumeM3">) => JSON.stringify([normalized(balloon.manufacturer), normalized(balloon.model), balloon.volumeM3]);
export const balloonMlmRuleKey = (rule: MoroccoLandingMassRule) => JSON.stringify(rule);
export function balloonMlmRules(balloon: Pick<Balloon, "manufacturer" | "model">) {
  return MOROCCO_LANDING_MASS_RULES.filter(r => normalized(r.manufacturer) === normalized(balloon.manufacturer) && normalized(r.model) === normalized(balloon.model));
}
export function balloonMlmProposal(balloon: Pick<Balloon, "manufacturer" | "model">): MoroccoLandingMassRule | null {
  const rules = balloonMlmRules(balloon);
  return rules.length && rules.every(r => r.value === rules[0].value) ? rules[0] : null;
}
/** No ID: a review made while creating a new profile survives assignment of its local ID. */
export function balloonMlmConfigurationKey(balloon: Balloon): string {
  return JSON.stringify([normalized(balloon.registration), balloonMlmModelKey(balloon), balloon.category, balloon.applicableMtowKg ?? null,
    balloon.weights.envelopeKg ?? null, balloon.weights.basketKg ?? null, balloon.weights.burnerKg ?? null,
    [...balloon.weights.fullCylinders].sort((a,b) => a.id.localeCompare(b.id)).map(c => [c.id, c.label?.trim() ?? "", c.fullWeightKg])]);
}
export function balloonMlmConfirmationKey(balloon: Balloon, record: BalloonMinimumLandingMass): string {
  return JSON.stringify([balloonMlmConfigurationKey(balloon), record.valueKg, record.modelKey, record.ruleKey, record.reference]);
}
export function parseBalloonMinimumLandingMass(value: unknown): BalloonMinimumLandingMass | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.valueKg !== "number" || !Number.isFinite(r.valueKg) || r.valueKg <= 0 ||
    typeof r.modelKey !== "string" || typeof r.ruleKey !== "string" || typeof r.reference !== "string") return undefined;
  return { valueKg:r.valueKg, modelKey:r.modelKey, ruleKey:r.ruleKey, reference:r.reference, confirmed:r.confirmed === true,
    ...(typeof r.confirmationKey === "string" ? { confirmationKey:r.confirmationKey } : {}) };
}
export function balloonMinimumLandingMass(balloon: Balloon) {
  const record = parseBalloonMinimumLandingMass(balloon.minimumLandingMass);
  const rules = balloonMlmRules(balloon), proposal = balloonMlmProposal(balloon);
  const relevant = record?.modelKey === balloonMlmModelKey(balloon) ? record : undefined;
  const rule = rules.find(r => balloonMlmRuleKey(r) === relevant?.ruleKey);
  const confirmed = !!relevant && !!rule && rule.volumeM3 === balloon.volumeM3 && relevant.reference.trim().length > 0 && relevant.confirmed &&
    relevant.confirmationKey === balloonMlmConfirmationKey(balloon, relevant);
  const valueKg = relevant?.valueKg ?? proposal?.value ?? null;
  const source = relevant?.reference || (proposal ? `${proposal.source.file} ; ${proposal.source.edition} ; §${proposal.source.sections} ; pages ${proposal.source.pages.join(", ")}` : null);
  const documentary = valueKg !== null && rules.some(r => r.value === valueKg);
  return { valueKg, confirmed, source, documentary, rule:rule ?? proposal,
    notice:confirmed ? "Minimum confirmé pour la configuration enregistrée." : valueKg === null ? "Minimum constructeur à vérifier" : documentary ? "Valeur constructeur à confirmer" : "Valeur saisie à confirmer" };
}
/** Additive migration: never manufacture a value or a confirmation for an old profile. */
export function retainValidBalloonMlm(balloon: Balloon): Balloon {
  const record = parseBalloonMinimumLandingMass(balloon.minimumLandingMass);
  if (!record) { const { minimumLandingMass: _ignored, ...rest } = balloon; return rest; }
  if (!balloonMinimumLandingMass({ ...balloon, minimumLandingMass:record }).confirmed) {
    return { ...balloon, minimumLandingMass:{ ...record, confirmed:false, confirmationKey:undefined } };
  }
  return { ...balloon, minimumLandingMass:record };
}
