import { createBalloon } from './balloons.ts';
import { balloonMlmProposal, balloonMlmModelKey, balloonMlmRuleKey, balloonMlmConfirmationKey } from './balloonMinimumLandingMass.ts';
export const mlmBalloon = () => createBalloon({ registration:'CN-CBN', manufacturer:'Cameron', model:'Z275', category:'Libre à air chaud', volumeM3:7788, applicableMtowKg:2494, configurationLimitsConfirmed:true,
  weights:{envelopeKg:100,basketKg:300,burnerKg:100,fullCylinders:[{id:'c1',fullWeightKg:150}]} });
export function withConfirmedMlm(balloon, valueKg=1247) {
  const rule=balloonMlmProposal(balloon);
  const record={valueKg,modelKey:balloonMlmModelKey(balloon),ruleKey:balloonMlmRuleKey(rule),reference:`${rule.source.file}; ${rule.source.edition}; §${rule.source.sections}; reviewed actual aircraft and supplements`,confirmed:true};
  return {...balloon,minimumLandingMass:{...record,confirmationKey:balloonMlmConfirmationKey(balloon,record)}};
}
