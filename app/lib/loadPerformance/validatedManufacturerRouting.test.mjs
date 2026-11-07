import assert from "node:assert/strict";
import test from "node:test";
import { calculateOfficialLoad } from "./engine.ts";
import { calculatePilotValidationLoad } from "./candidateEngine.ts";
import { routeValidatedManufacturerLoad, matchesValidatedManufacturerActivation } from "./validatedManufacturerRouting.ts";
import { enabledOfficialLoadParameterCombinations, enabledPilotValidationLoadConfigurations } from "./modelParameters/activationRegistry.ts";
import { ultramagicModelParameters } from "./modelParameters/ultramagicModels.ts";
import { kubicekModelParameters } from "./modelParameters/kubicekModels.ts";
import { cameronModelParameters } from "./modelParameters/cameronModels.ts";
import { describePreparationLoad } from "../preparationLoadSupport.ts";
const inputFor = (p) => ({
  balloonId:"SYNTHETIC_ROUTING_ONLY", manufacturer:p.manufacturer, model:p.model, volumeM3:p.volumeM3,
  applicableMtowKg:p.standardMtomKg, balloonEquipmentWeightKg:200, occupantsWeightKg:100,
  launchElevationMslM:0, plannedMaximumAltitudeMslM:1000, configurationLimitsConfirmed:true,
  groundTemperature:{temperatureC:15,sourceModel:"TEST_ONLY",forecastRun:"TEST",validTime:"TEST"},
});
function assertBlocked(result) {
  assert.equal(result.status,"UNAVAILABLE");
  for(const key of ["marginKg","permittedTotalMassKg","availableOccupantsCapacityKg","theoretical"]) assert.equal(key in result,false,key);
}
for(const [parameters,methodReason] of [[ultramagicModelParameters,"METHOD_NOT_VALIDATED"],[kubicekModelParameters,"LU_METHOD_NOT_VALIDATED"]]) {
  test(`${parameters[0].manufacturer}: tous les modèles routés restent bloqués avec motifs, pas de marge`,()=>{
    for(const p of parameters) {
      const input=inputFor(p);
      const result=calculateOfficialLoad(input);
      assertBlocked(result);
      assert.equal(result.reasonCode,"PENDING_VERIFICATION",p.model);
      assert.match(result.message,new RegExp(p.source.manualRevision));
      assert.ok(result.message.includes(methodReason),p.model);
      const presentation=describePreparationLoad(input,result);
      assert.equal(presentation.candidateEnabled,false);
      assert.equal(presentation.message,result.message); // Existing pending-validation UI retains the reason.
      assert.equal(presentation.parameterId,p.id);
    }
  });
}

test("activation : identité exacte et toutes les validations requises, sans activer les candidats",()=>{
  for(const p of [ultramagicModelParameters[0],kubicekModelParameters[0]]) {
    const activation={key:{manufacturerMethodId:p.manufacturerMethodId,modelParameterSetId:p.id,manualRevision:p.source.manualRevision,configurationLimitsConfirmed:true},methodValidated:true,modelParametersVerified:true,sourcesTraceable:true,targetedTestsPassing:true};
    assert.equal(matchesValidatedManufacturerActivation(p,activation),false); // Candidate status is insufficient.
    const verified={...p,verificationStatus:"VERIFIED_FROM_OFFICIAL_MANUAL"}; // Pure matcher fixture, no registry mutation.
    assert.equal(matchesValidatedManufacturerActivation(verified,activation),true);
    for(const flag of ["methodValidated","modelParametersVerified","sourcesTraceable","targetedTestsPassing"]) {
      assert.equal(matchesValidatedManufacturerActivation(verified,{...activation,[flag]:false}),false,flag);
    }
    for(const key of ["manufacturerMethodId","modelParameterSetId","manualRevision"]) {
      assert.equal(matchesValidatedManufacturerActivation(verified,{...activation,key:{...activation.key,[key]:"OTHER"}}),false,key);
    }
    assert.equal(matchesValidatedManufacturerActivation(verified,{...activation,key:{...activation.key,configurationLimitsConfirmed:false}}),false);
  }
  assert.equal(enabledOfficialLoadParameterCombinations.length,0);
  assert.ok(enabledPilotValidationLoadConfigurations.every((entry)=>entry.manufacturerMethodId==="CAMERON_METHOD_A2"));
});

test("checkbox, métadonnées officielles ou objet d'activation fourni ne contournent pas le registre ni les preuves",()=>{
  for(const p of [ultramagicModelParameters.find(p=>p.model==="T150"),kubicekModelParameters.find(p=>p.model==="BB20")]) {
    for(const confirmed of [false,true]) {
      const result=calculateOfficialLoad({...inputFor(p),configurationLimitsConfirmed:confirmed,
        officialManualId:p.source.manualId,officialManualRevision:p.source.manualRevision,officialLoadDatasetId:p.id,
        activation:{methodValidated:true,modelParametersVerified:true,sourcesTraceable:true,targetedTestsPassing:true}});
      assertBlocked(result);
      assert.equal(result.reasonCode,"PENDING_VERIFICATION");
      assert.match(result.message,/UNVERIFIED|NON_VALIDÉ/);
    }
  }
});

test("preuves réelles manquantes/étrangères conservées dans le diagnostic du routage",()=>{
  const um=ultramagicModelParameters.find(p=>p.model==="T150");
  const ultramagic=calculateOfficialLoad({...inputFor(um),fm04Evidence:{balloonId:"OTHER",model:um.model,manualRevision:"FM04_REVISION_30"}});
  assertBlocked(ultramagic);
  assert.match(ultramagic.message,/EVIDENCE_IDENTITY_MISMATCH/);
  assert.match(ultramagic.message,/APPLICABLE_SUPPLEMENTS_UNVERIFIED/);
  const kb=kubicekModelParameters.find(p=>p.model==="BB20");
  const kubicek=calculateOfficialLoad({...inputFor(kb),kubicekEvidence:{balloonId:"OTHER",model:kb.model,manualRevision:"B3102_ED3_REV22"}});
  assertBlocked(kubicek);
  assert.match(kubicek.message,/AIRCRAFT_EVIDENCE_UNVERIFIED/);
  assert.match(kubicek.message,/FLIGHT_AND_LANDING_MASSES_UNVERIFIED/);
});

test("modèles absents, mauvais volume, MTOW supérieure, domaine et température manquante restent bloqués",()=>{
  for(const p of [ultramagicModelParameters[0],kubicekModelParameters[0]]) {
    for(const overrides of [{model:"UNKNOWN"},{volumeM3:p.volumeM3+100},{applicableMtowKg:p.standardMtomKg+1},{groundTemperature:undefined},{plannedMaximumAltitudeMslM:-1}]) {
      const result=calculateOfficialLoad({...inputFor(p),...overrides});
      assertBlocked(result);
      if(overrides.model) assert.equal(result.reasonCode,"UNSUPPORTED_MODEL");
      if("groundTemperature" in overrides) assert.equal(result.reasonCode,"NO_GROUND_TEMPERATURE");
    }
  }
  const kb=kubicekModelParameters.find(p=>p.model==="BB20");
  const out=calculateOfficialLoad({...inputFor(kb),groundTemperature:{...inputFor(kb).groundTemperature,temperatureC:100}});
  assertBlocked(out); assert.equal(out.reasonCode,"OUTSIDE_OFFICIAL_TABLE");
});

test("Cameron : le nouveau routage ne prend aucun modèle, même avec preuves tierces ; résultats de production identiques",()=>{
  const withoutTime=({calculatedAt,...result})=>result;
  for(const p of cameronModelParameters) {
    for(const confirmed of [true,false]) {
      const input={...inputFor(p),configurationLimitsConfirmed:confirmed,fm04Evidence:{balloonId:"OTHER"},kubicekEvidence:{balloonId:"OTHER"}};
      assert.equal(routeValidatedManufacturerLoad(input),null);
      assert.deepEqual(withoutTime(calculateOfficialLoad(input)),withoutTime(calculatePilotValidationLoad(input)),p.model);
    }
  }
});


test("FM04 : aucune extrapolation mathématique hors du graphique ne devient une charge admissible",()=>{
  const p=ultramagicModelParameters.find(p=>p.model==="H65");
  for(const overrides of [{groundTemperature:{...inputFor(p).groundTemperature,temperatureC:-60}},
    {groundTemperature:{...inputFor(p).groundTemperature,temperatureC:45}},
    {plannedMaximumAltitudeMslM:8000}]) {
    const output=calculateOfficialLoad({...inputFor(p),...overrides});
    assertBlocked(output);
    assert.equal(output.reasonCode,"PENDING_VERIFICATION");
    assert.match(output.message,/METHOD_NOT_VALIDATED/);
  }
});
