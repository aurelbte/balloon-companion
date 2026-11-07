import { kubicekB3102Ed3Rev23Source, kubicekRev23CompatibilityRows, kubicekOrigoEquipment, KUBICEK_MAXIMUM_ENVELOPE_TEMPERATURE_C } from "../datasets/kubicekB3102Ed3Rev23.ts";
import type { LoadCalculationInput } from "../types.ts";
import { findExactKubicekModel } from "../modelParameters/kubicekModels.ts";

/** B.3102 Ed.3 Rev.23, 2-5/2-6 Rev.23. MLW applies throughout flight (2-4 Rev.23). */
const mlwRows: readonly (readonly [readonly string[], number])[] = [
  [["BB9","BB9E","BB9EF"],135], [["BB12","BB12E","BB12EF"],180], [["BB14XR"],210], [["Origo 15"],220], [["Origo 18"],255],
  [["BB16","BB16E","BB16EF","BB16XR"],230], [["BB17GP","BB17XR"],250], [["BB18E","BB18XR"],255],
  [["BB20","BB20E","BB20ED","BB20GP","BB20XR"],280],
  [["BB22","BB22D","BB22ED","BB22E","BB22N","BB22Z","BB22XR","BB22M"],300],
  [["BB26","BB26D","BB26ED","BB26E","BB26N","BB26Z","BB26XR","BB26M","BB30E","BB30ED","BB30M"],340],
  [["BB30D","BB30N","BB30Z","BB30XR"],410], [["BB34D","BB34ED","BB34E","BB34Z"],455],
  [["BB37D","BB37N","BB37Z"],500], [["BB40D","BB40Z"],580], [["BB42D","BB42Z"],630],
  [["BB45D","BB45N","BB45Z"],670], [["BB51D","BB51Z"],780], [["BB60D","BB60N","BB60Z"],930],
  [["BB64Z"],1000], [["BB70D","BB70Z"],1060], [["BB74Z"],1130], [["BB78Z"],1200],
  [["BB85D","BB85Z"],1350], [["BB92Z"],1450], [["BB100D","BB100Z"],1600],
  [["BB105P","BB106P"],1700], [["BB113P"],1800], [["BB120P"],1850], [["BB130P"],1950],
  [["BB142P"],2000], [["BB150P"],2100], [["BB184P"],2500],
];
export const kubicekMinimumLandingMassKg = (model: string) => mlwRows.find(([models]) => models.includes(model))?.[1];

/** 2-6 Rev.23 / 2-7 Rev.5. Serial numbers <400 require Appendix 4, not these limits. */
const baskets: Readonly<Record<string, readonly [number, number]>> = {
  ORIGO:[kubicekOrigoEquipment.basketMaximumCarriedKg,kubicekOrigoEquipment.maximumOccupants], K7:[450,2], K10:[600,3], K10C:[455,2], K10S:[455,3], K11:[650,3], K12:[700,4], K12A:[700,4],
  K13:[700,4], K13C:[550,3], K13S:[550,3], K14:[800,5], K15:[800,5], K16:[900,5], K17:[900,5],
  K18:[950,6], K19:[950,6], K19L:[950,6], K22:[980,8], K23:[980,6], K25P:[1000,8], K28:[1100,8],
  K28H:[1100,8], K30PP:[1100,10], K32Y:[1100,10], K32T:[1100,10], K32TT:[1100,10],
  K40Y:[1200,12], K40T:[1200,12], K40TTA:[1200,12], K50:[1400,14], K50TT:[1400,14],
  K50TTA:[1400,14], K50TT8:[1400,14], K55X:[1700,16], K55TTA:[1700,16], K58HH:[1400,14],
  K60:[1800,18], K60X:[1800,18], K65TTA:[2500,20], K70:[3000,22], K70TTA:[3000,22],
  K80:[3400,26], K85:[3400,26], K90:[3400,26], K100:[4000,30], K110:[4000,34],
};
/** 2-10 Rev.23: [volume at 7.5 m/s, optional volume at 5.5 m/s]. */
const frames: Readonly<Record<string, readonly [number | null, number?]>> = {
  ORIGO:[null,kubicekOrigoEquipment.frameMaximumVolumeM3], SIRIUS:[4000], BASIC:[4500], VARIO:[4500], K23:[4500], K25P:[6000], K30PP:[7000],
  K32T:[6000,7000], K32TT:[7000], K50:[8500,9200], K50TT:[8500], K60:[12000],
  "K60 STRONG":[14200], K60X:[14200], K100:[14200], "K100 STRONG":[14200,18400],
};

type Review = Readonly<{
  reference: string; page: string; approved: boolean; conditionsSatisfied: boolean;
  // Exact [envelope, basket, basket S/N, frame, frame S/N, burner, burner S/N].
  componentIds: readonly (string | number)[];
}>;
/** Explicit aircraft documentary evidence; never populated by /map's generic confirmation checkbox. */
export type KubicekEvidence = Readonly<{
  balloonId: string; model: string; manualRevision: typeof kubicekB3102Ed3Rev23Source.evidenceRevision;
  weightRecord?: Readonly<{ reference: string; applicableMtowKg: number; minimumCrewAndEquipmentKg: number; reducedMtowCountersignedByKubicek: boolean }>;
  configuration?: Readonly<{
    reference: string; basketModel: string; basketSerialNumber: number; frameModel: string; frameSerialNumber: string;
    frameHasSnMark: boolean; burnerModel: string; burnerSerialNumber: string;
    envelopeBasket: Review; envelopeBurner: Review; basketFrame: Review;
    flyingWiresAndAirworthinessVerified: boolean; occupancyAndCylinderLayoutVerified: boolean;
    rotationVentFitted?: boolean; plannedMaximumEnvelopeTemperatureC?: number;
    envelopeTemperatureLimitsVerified: boolean; envelopeTemperatureLimitReference: string;
    occupantCount: number; maximumSurfaceWindMs: number;
    basketPlate: Readonly<{ reference: string; model: string; serialNumber: number; emptyWeightKg: number; maximumCarriedKg?: number }>;
  }>;
  masses?: Readonly<{
    reference: string; complete: boolean; fullCylindersVerified: boolean;
    envelopeKg: number; emptyBasketKg: number; burnerAndFrameKg: number; fullCylindersKg: number;
    otherEquipmentKg: number; occupantsKg: number; baggageKg: number;
    basketCarriedKg: number; carriageAllocationReference: string;
  }>;
  flightMasses?: Readonly<{ reference: string; complete: boolean; landingKg: number; minimumKg: number; maximumKg: number }>;
  supplements?: Readonly<{ reference: string; applicability: "NONE_APPLICABLE" | "REVIEWED"; requirementsVerified: boolean }>;
  temperatureAssessment?: Readonly<{ reference: string; inversionReviewed: boolean; standardDecreaseApplicable: boolean }>;
}>;
export type KubicekCandidateInput = LoadCalculationInput & { kubicekEvidence?: KubicekEvidence };
export type KubicekBlock = Readonly<{ code: string; source: string; message: string }>;
const ref = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const positive = (v: unknown): v is number => nonnegative(v) && v > 0;
// Floating arithmetic only: never a manufacturer mass tolerance.
const sameMass = (a: number, b: number) => Math.abs(a-b) <= Number.EPSILON * Math.max(1,Math.abs(a),Math.abs(b)) * 8;

export function evaluateKubicekEvidence(input: KubicekCandidateInput) {
  const blocks: KubicekBlock[] = [];
  const block = (code: string, source: string, message: string) => blocks.push({ code, source, message });
  const parameters = findExactKubicekModel(input.model ?? "");
  const supplied = input.kubicekEvidence;
  const e = supplied && ref(input.balloonId) && supplied.balloonId === input.balloonId
    && supplied.model === input.model && supplied.manualRevision === kubicekB3102Ed3Rev23Source.evidenceRevision ? supplied : undefined;
  if (!e) block("AIRCRAFT_EVIDENCE_UNVERIFIED", "II Rev.23", "Preuves absentes ou identité ballon/modèle/révision incohérente.");
  if (!parameters || input.manufacturer?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase() !== "KUBICEK") block("MODEL_MISMATCH", "2-5 / 8-1 / 8-2", "Modèle constructeur exact non identifié.");
  if (!positive(input.volumeM3) || input.volumeM3 !== parameters?.volumeM3) block("VOLUME_MISMATCH", "8-1 Rev.23 / 8-2 Rev.22", "Volume absent ou différent du volume documentaire exact.");
  const mtow = input.applicableMtowKg;
  const standard = parameters?.standardMtomKg;
  if (!positive(mtow) || !positive(standard) || mtow > standard) block("MTOW_INVALID", "2-4 Rev.23 / 2-5/2-6 Rev.23", "MTOW absente, invalide ou supérieure au plafond constructeur.");
  const record = e?.weightRecord;
  if (!record || !ref(record.reference) || record.applicableMtowKg !== mtow || !positive(record.minimumCrewAndEquipmentKg)) block("WEIGHT_RECORD_UNVERIFIED", "II Rev.23 / 2-4 Rev.23", "MTOW/RMTOW individuelle et masse minimale complète non documentées.");
  if (positive(mtow) && positive(standard) && mtow < standard && (!record || record.reducedMtowCountersignedByKubicek !== true || !positive(record.minimumCrewAndEquipmentKg) || mtow < Math.max(0.55*standard,record.minimumCrewAndEquipmentKg))) block("RMTOW_UNVERIFIED", "II Rev.23 / 2-4 Rev.23", "RMTOW : accord Kubicek et plancher réglementaire constructeur non prouvés.");

  const m = e?.masses;
  const equipment = m ? m.envelopeKg+m.emptyBasketKg+m.burnerAndFrameKg+m.fullCylindersKg+m.otherEquipmentKg : NaN;
  const takeoff = m ? equipment+m.occupantsKg+m.baggageKg : NaN;
  const massesOK = !!m && ref(m.reference) && m.complete === true && m.fullCylindersVerified === true
    && [m.envelopeKg,m.emptyBasketKg,m.burnerAndFrameKg,m.fullCylindersKg].every(positive)
    && [m.otherEquipmentKg,m.occupantsKg,m.baggageKg,m.basketCarriedKg].every(nonnegative)
    && Number.isFinite(takeoff) && positive(input.balloonEquipmentWeightKg) && nonnegative(input.occupantsWeightKg)
    && sameMass(equipment,input.balloonEquipmentWeightKg) && sameMass(m.occupantsKg,input.occupantsWeightKg);
  if (!massesOK) block("COMPLETE_MASSES_UNVERIFIED", "II Rev.23 / 5-1 Rev.0 / 5-2 Rev.16", "Masses complètes et cylindres pleins absents, invalides ou incohérents.");
  const carriedOK = massesOK && ref(m.carriageAllocationReference) && m.basketCarriedKg >= m.occupantsKg
    && m.basketCarriedKg <= takeoff-m.envelopeKg-m.emptyBasketKg;
  if (!carriedOK) block("BASKET_CARRIED_MASS_UNVERIFIED", "2-7 Rev.5 / 5-1 Rev.0", "Charge réellement transportée par la nacelle non documentée (hors nacelle vide).");
  if (massesOK && positive(mtow) && takeoff > mtow) block("TAKEOFF_EXCEEDS_MTOW", "2-4 Rev.23 / 5-1 Rev.0", "Masse au décollage supérieure à la MTOW/RMTOW applicable.");
  const mlw = kubicekMinimumLandingMassKg(input.model ?? "");
  if (mlw === undefined) block("MLW_UNVERIFIED", "2-5/2-6 Rev.23", "MLW du modèle non documentée.");
  if (massesOK && mlw !== undefined && takeoff < mlw) block("TAKEOFF_BELOW_MLW", "2-4 Rev.23 / 2-5/2-6 Rev.23", "Masse au décollage inférieure à la MLW.");
  const flight = e?.flightMasses;
  const flightOK = !!flight && ref(flight.reference) && flight.complete === true
    && [flight.landingKg,flight.minimumKg,flight.maximumKg].every(positive) && massesOK
    && flight.minimumKg <= Math.min(takeoff,flight.landingKg) && flight.maximumKg >= Math.max(takeoff,flight.landingKg);
  if (!flightOK) block("FLIGHT_AND_LANDING_MASSES_UNVERIFIED", "2-4 Rev.23", "Masse à l'atterrissage et bornes de masse pendant tout le vol non prouvées.");
  if (flightOK && mlw !== undefined && flight.minimumKg < mlw) block("FLIGHT_BELOW_MLW", "2-4 Rev.23 / 2-5/2-6 Rev.23", "Masse en vol ou à l'atterrissage inférieure à la MLW.");
  if (flightOK && positive(mtow) && flight.maximumKg > mtow) block("FLIGHT_EXCEEDS_MTOW", "2-4 Rev.23", "Masse en vol supérieure à la MTOW/RMTOW.");

  const c = e?.configuration;
  const configurationOK = !!c && ref(c.reference) && ref(c.basketModel) && Number.isInteger(c.basketSerialNumber) && c.basketSerialNumber > 0
    && ref(c.frameModel) && ref(c.frameSerialNumber) && typeof c.frameHasSnMark === "boolean" && ref(c.burnerModel) && ref(c.burnerSerialNumber);
  if (!configurationOK || input.configurationLimitsConfirmed !== true) block("CONFIGURATION_UNVERIFIED", "II Rev.23 / 2.11", "Nacelle, cadre et brûleur réels non identifiés et documentés.");
  const componentIds = c ? [input.model, c.basketModel, c.basketSerialNumber, c.frameModel, c.frameSerialNumber, c.burnerModel, c.burnerSerialNumber] : [];
  const reviewed = (r: Review | undefined, pages: string[]) => !!r && ref(r.reference) && pages.includes(r.page)
    && r.approved === true && r.conditionsSatisfied === true && Array.isArray(r.componentIds)
    && r.componentIds.length === componentIds.length && r.componentIds.every((value,index) => value === componentIds[index]);
  // Human documentary reviews must concern this evidence's exact named components.
  // No matrix cell or approved combination is inferred from the volume or model family.
  if (!configurationOK || !reviewed(c.envelopeBasket,["2-8","2-9"])) block("ENVELOPE_BASKET_UNVERIFIED", "2-8/2-9 Rev.23", "Cellule enveloppe/nacelle et conditions RV/40 kN non vérifiées.");
  if (!configurationOK || !reviewed(c.envelopeBurner,["2-11"])) block("ENVELOPE_BURNER_UNVERIFIED", "2-11 Rev.23", "Cellule enveloppe/brûleur et conditions de numéro de série non vérifiées.");
  if (!configurationOK || !reviewed(c.basketFrame,c.basketSerialNumber >= 400 ? ["8-3","8-4"] : ["9-5"]) || c.flyingWiresAndAirworthinessVerified !== true) block("BASKET_FRAME_UNVERIFIED", "II Rev.23 / 8.2 / Appendice 4", "Cadre/nacelle, longueur des câbles et navigabilité non vérifiés.");
  if (configurationOK) {
    if (c.envelopeTemperatureLimitsVerified !== true || !ref(c.envelopeTemperatureLimitReference)) block("ENVELOPE_TEMPERATURE_LIMIT_UNVERIFIED", "2-4 Rev.23 §2.8", "Limite maximale d’enveloppe 124 °C (Rev.23) non vérifiée pour la configuration réelle.");
    if (c.plannedMaximumEnvelopeTemperatureC !== undefined && (!Number.isFinite(c.plannedMaximumEnvelopeTemperatureC)
      || c.plannedMaximumEnvelopeTemperatureC > KUBICEK_MAXIMUM_ENVELOPE_TEMPERATURE_C)) block("ENVELOPE_TEMPERATURE_EXCEEDED", "2-4 Rev.23 §2.8", "Température maximale d’enveloppe supérieure à 124 °C ou invalide.");
    const changedRow = kubicekRev23CompatibilityRows[input.model ?? ""];
    if (changedRow?.basketPage && c.envelopeBasket?.page !== changedRow.basketPage) block("ENVELOPE_BASKET_UNVERIFIED", "2-8/2-9 Rev.23", "La revue ne référence pas la page de la ligne Origo exacte.");
    if (changedRow?.baskets && !changedRow.baskets.includes(c.basketModel)
      || c.basketModel === "ORIGO" && !["Origo 15","Origo 18"].includes(input.model ?? "")) block("ENVELOPE_BASKET_INCOMPATIBLE", "2-8/2-9 Rev.23", "Combinaison enveloppe/nacelle non approuvée dans les cellules Origo transcrites.");
    if (changedRow?.rotationVentBaskets?.includes(c.basketModel) && c.rotationVentFitted !== true) block("ROTATION_VENT_UNVERIFIED", "2-8/2-9 Rev.23", "Rotation vent requis (RV) pour cette combinaison et non prouvé.");
    if (changedRow && !changedRow.burners.includes(c.burnerModel)
      || c.burnerModel === "ORIGO" && !["Origo 15","Origo 18"].includes(input.model ?? "")) block("ENVELOPE_BURNER_INCOMPATIBLE", "2-11 Rev.23", "Combinaison enveloppe/brûleur non approuvée dans la ligne exacte transcrite.");
    const serial = /^\d+$/.test(c.burnerSerialNumber) ? Number(c.burnerSerialNumber) : NaN;
    if (changedRow && (c.burnerModel === "KOMET DUO UP TO 104" || c.burnerModel === "KOMET DUO 105+")) {
      if (!Number.isSafeInteger(serial) || serial <= 0) block("BURNER_SERIAL_UNVERIFIED", "2-11 Rev.23", "Numéro de série KOMET DUO non vérifiable.");
      else if (c.burnerModel === "KOMET DUO UP TO 104" ? serial > 104 : serial < 105) block("BURNER_SERIAL_INCOMPATIBLE", "2-11 Rev.23", "Numéro de série différent de la colonne KOMET DUO sélectionnée.");
    }
    if (changedRow?.ignisTwoUnitsMinimumSerial && c.burnerModel === "IGNIS - 2 units"
      && (!Number.isSafeInteger(serial) || serial < changedRow.ignisTwoUnitsMinimumSerial)) block("BURNER_SERIAL_UNVERIFIED", "2-11 Rev.23", "IGNIS 2 units : S/N 516 ou supérieur requis pour cette ligne.");
    if ((c.basketModel === "ORIGO" || c.burnerModel === "ORIGO") && c.frameModel !== "ORIGO"
      || c.frameModel === "ORIGO" && (c.basketModel !== "ORIGO" || c.burnerModel !== "ORIGO")) block("ORIGO_FRAME_INCOMPATIBLE", "8-3/8-5 Rev.23", "La nacelle et le brûleur Origo exigent le cadre Origo ; pas d’interchangeabilité déduite.");
    const basket = c.basketSerialNumber >= 400 ? baskets[c.basketModel] : undefined;
    if (!basket) block("BASKET_LIMITS_UNVERIFIED", "2-6 Rev.23 / 2-7 Rev.5 / Appendice 4", "Nacelle non couverte ; pour S/N <400, limites Appendice 4 à vérifier.");
    const plate = c.basketPlate;
    const plateOK = !!plate && ref(plate.reference) && plate.model === c.basketModel && plate.serialNumber === c.basketSerialNumber && positive(plate.emptyWeightKg)
      && massesOK && sameMass(plate.emptyWeightKg,m.emptyBasketKg)
      && (plate.maximumCarriedKg === undefined || positive(plate.maximumCarriedKg));
    if (!plateOK) block("BASKET_PLATE_UNVERIFIED", "II Rev.23 / 2.10", "Identification et masse à vide de la nacelle réelle non documentées ou incohérentes.");
    if (carriedOK && (basket && m.basketCarriedKg > basket[0] || plateOK && positive(plate.maximumCarriedKg) && m.basketCarriedKg > plate.maximumCarriedKg)) block("BASKET_OVERLOADED", "2-6 Rev.23 / 2-7 Rev.5", "Charge transportée supérieure à la limite nacelle ou à sa plaque.");
    if (!Number.isInteger(c.occupantCount) || c.occupantCount < 1 || !basket || c.occupantCount > basket[1] || c.occupancyAndCylinderLayoutVerified !== true) block("BASKET_OCCUPANCY_UNVERIFIED", "2.10 / Appendice 2 (9-2 Rev.0)", "Occupation et surface résiduelle par compartiment avec cylindres non vérifiées.");
    const frame = frames[c.frameModel];
    const wind = c.maximumSurfaceWindMs;
    const maxVolume = frame && nonnegative(wind) && wind <= 7.5 ? (wind <= 5.5 ? frame[1] ?? frame[0] : frame[0]) : undefined;
    if (c.frameModel === "ORIGO" && nonnegative(wind) && wind > kubicekOrigoEquipment.frameMaximumSurfaceWindMs) block("FRAME_WIND_EXCEEDED", "2-10 Rev.23", "Cadre Origo : vent maximal de 5,5 m/s dépassé.");
    if (!maxVolume || !positive(input.volumeM3)) block("FRAME_LIMITS_UNVERIFIED", "2-10 Rev.23", "Type de cadre ou vent maximal non exploitable.");
    else if (input.volumeM3 > maxVolume) block("FRAME_VOLUME_EXCEEDED", "2-10 Rev.23", "Volume supérieur à la limite du cadre pour le vent prévu.");
    if (c.frameModel === "K50" && positive(input.volumeM3) && input.volumeM3 >= 7400 && c.frameHasSnMark !== true) block("FRAME_SN_MARK_REQUIRED", "2-10 Rev.23", "K50 de 7400 à 9200 m³ : marquage S/N requis.");
    const appendix6Wind = input.model === "BB70Z" ? 5.5 : ["BB60N","BB60Z"].includes(input.model ?? "") ? 6 : undefined;
    if (["K32T","K40Y"].includes(c.basketModel) && c.frameHasSnMark === false && appendix6Wind !== undefined
      && (!nonnegative(wind) || wind > appendix6Wind)) block("APPENDIX_6_WIND_LIMIT", "9-7 Rev.0", "Vent supérieur à la limite Appendice 6, ou non documenté, pour ce modèle et cadre sans marquage S/N.");
  }
  if (!e?.supplements || !ref(e.supplements.reference) || !["NONE_APPLICABLE","REVIEWED"].includes(e.supplements.applicability) || e.supplements.requirementsVerified !== true) block("SUPPLEMENTS_UNVERIFIED", "II Rev.23 / Section 9", "Applicabilité et exigences des suppléments/appendices non documentées.");
  if (!e?.temperatureAssessment || !ref(e.temperatureAssessment.reference) || e.temperatureAssessment.inversionReviewed !== true || e.temperatureAssessment.standardDecreaseApplicable !== true) block("TEMPERATURE_ASSUMPTION_UNVERIFIED", "5-1 Rev.0 §5.2 / §5.3", "Décroissance standard/inversion non vérifiée ; ne pas substituer silencieusement une température.");
  return { blocks, takeoffMassKg: massesOK ? takeoff : undefined, maximumFlightMassKg: flightOK ? flight.maximumKg : undefined };
}
