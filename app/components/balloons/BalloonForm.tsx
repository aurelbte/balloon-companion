"use client";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { catalogManufacturers, catalogModels, catalogVolume, catalogModelDisplayName } from "../../lib/balloonCatalog";
import { balloonFormSectionDefaults, mtomAfterModelChange, mtomAfterManualChange } from "../../lib/balloonFormPolicy";
import { balloonMassFormDraft, canSubmitHydratedBalloonForm } from "../../lib/balloonFormHydration";
import { calculateBalloonWeight, type Balloon, type BalloonCategory, type BalloonInput } from "../../lib/balloons";
import { applicableMtomCatalogEntry, proposedApplicableMtowKg } from "../../lib/loadPerformance/modelParameters/mtomCatalog";
import { balloonMlmRules, balloonMlmProposal, balloonMlmModelKey, balloonMlmRuleKey, balloonMlmConfirmationKey, balloonMinimumLandingMass, type BalloonMinimumLandingMass } from "../../lib/balloonMinimumLandingMass";
import styles from "../../more/More.module.css";

const OTHER = "__other__";
type CylinderDraft = { id: string; label: string; weight: string };
type Props = { balloon?: Balloon; submitLabel: string; onSubmit: (input: BalloonInput) => void; onCancel: () => void; submissionError?: string | null };
function parseDecimal(value: string): number | undefined { if (!value.trim()) return undefined; const number = Number(value.replace(",", ".")); return Number.isFinite(number) ? number : undefined; }
function decimalInput(value: string): string { return value.replace(/[^0-9.,]/g, "").replace(/([.,].*)[.,]/g, "$1"); }
export default function BalloonForm({ balloon, submitLabel, onSubmit, onCancel, submissionError }: Props) {
  const initialMassDraft = balloonMassFormDraft(balloon);
  const sectionDefaults = balloonFormSectionDefaults(balloon?.applicableMtowKg !== undefined, balloon?.configurationLimitsConfirmed === true);
  const knownManufacturer = balloon && catalogManufacturers().includes(balloon.manufacturer);
  const knownModel = balloon && catalogModels(balloon.manufacturer).some(({ model }) => model === balloon.model);
  const [mlmDraft, setMlmDraft] = useState<BalloonMinimumLandingMass | undefined>(balloon?.minimumLandingMass);
  const [mlmText, setMlmText] = useState(balloon?.minimumLandingMass ? String(balloon.minimumLandingMass.valueKg) : undefined);
  const [registration, setRegistration] = useState(balloon?.registration ?? "");
  const [manufacturerChoice, setManufacturerChoice] = useState(balloon ? knownManufacturer ? balloon.manufacturer : OTHER : "");
  const [manualManufacturer, setManualManufacturer] = useState(balloon && !knownManufacturer ? balloon.manufacturer : "");
  const [modelChoice, setModelChoice] = useState(balloon ? knownModel ? balloon.model : OTHER : "");
  const [manualModel, setManualModel] = useState(balloon && !knownModel ? balloon.model : "");
  const [category, setCategory] = useState<BalloonCategory>(balloon?.category ?? "Libre à air chaud");
  const [volume, setVolume] = useState(balloon ? String(balloon.volumeM3) : "");
  const [volumeFromCatalog, setVolumeFromCatalog] = useState(false);
  const initialProposedMtow = balloon?.applicableMtowKg === undefined && balloon
    ? proposedApplicableMtowKg(balloon.manufacturer, balloon.model)
    : null;
  const [applicableMtow, setApplicableMtow] = useState(balloon?.applicableMtowKg === undefined ? initialProposedMtow === null ? "" : String(initialProposedMtow) : String(balloon.applicableMtowKg));
  const [mtomFromCatalog, setMtomFromCatalog] = useState(initialProposedMtow !== null);
  const [selectedMtomOptionId, setSelectedMtomOptionId] = useState("");
  const [configurationLimitsConfirmed, setConfigurationLimitsConfirmed] = useState(balloon?.configurationLimitsConfirmed === true);
  const [identityOpen, setIdentityOpen] = useState(sectionDefaults.identity);
  const [massesOpen, setMassesOpen] = useState(sectionDefaults.masses);
  const [limitsOpen, setLimitsOpen] = useState(sectionDefaults.limits);
  const [envelope, setEnvelope] = useState(initialMassDraft.envelope);
  const [burner, setBurner] = useState(initialMassDraft.burner);
  const [basket, setBasket] = useState(initialMassDraft.basket);
  const [cylinders, setCylinders] = useState<CylinderDraft[]>([...initialMassDraft.cylinders]);
  const [color, setColor] = useState(balloon?.color ?? "");
  const [hydrationReady, setHydrationReady] = useState(!balloon);
  const hydratedBalloonIdRef = useRef<string | null>(null);
  const [focusCylinderId, setFocusCylinderId] = useState<string | null>(null);
  const cylinderInputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (!balloon || hydratedBalloonIdRef.current === balloon.id) return;
    setHydrationReady(false);
    setMlmDraft(balloon.minimumLandingMass); setMlmText(balloon.minimumLandingMass ? String(balloon.minimumLandingMass.valueKg) : undefined);
    setRegistration(balloon.registration);
    setManufacturerChoice(knownManufacturer ? balloon.manufacturer : OTHER);
    setManualManufacturer(knownManufacturer ? "" : balloon.manufacturer);
    setModelChoice(knownModel ? balloon.model : OTHER);
    setManualModel(knownModel ? "" : balloon.model);
    setCategory(balloon.category);
    setVolume(String(balloon.volumeM3));
    setApplicableMtow(balloon.applicableMtowKg === undefined ? "" : String(balloon.applicableMtowKg));
    setMtomFromCatalog(false);
    setSelectedMtomOptionId("");
    setConfigurationLimitsConfirmed(balloon.configurationLimitsConfirmed === true);
    const massDraft = balloonMassFormDraft(balloon);
    setEnvelope(massDraft.envelope);
    setBurner(massDraft.burner);
    setBasket(massDraft.basket);
    setCylinders([...massDraft.cylinders]);
    setColor(balloon.color ?? "");
    hydratedBalloonIdRef.current = balloon.id;
    setHydrationReady(true);
  }, [balloon, knownManufacturer, knownModel]);
  useEffect(() => {
    if (!focusCylinderId) return;
    const timer = window.setTimeout(() => {
      cylinderInputs.current.get(focusCylinderId)?.focus();
      setFocusCylinderId(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusCylinderId]);
  const manufacturer = manufacturerChoice === OTHER ? manualManufacturer.trim() : manufacturerChoice;
  const model = manufacturerChoice === OTHER || modelChoice === OTHER ? manualModel.trim() : modelChoice;
  const catalogDocumentation = catalogModels(manufacturer).find((item) => item.model === model);
  const mtomCatalogEntry = applicableMtomCatalogEntry(manufacturer, model);
  const hasSeveralApplicableLimits = Boolean(mtomCatalogEntry && (mtomCatalogEntry.options.length > 1 || mtomCatalogEntry.aircraftSpecificReducedLimitPossible));
  const volumeM3 = parseDecimal(volume); const parsedApplicableMtowKg = parseDecimal(applicableMtow); const applicableMtowKg = parsedApplicableMtowKg && parsedApplicableMtowKg > 0 ? parsedApplicableMtowKg : undefined; const envelopeKg = parseDecimal(envelope); const burnerKg = parseDecimal(burner); const basketKg = parseDecimal(basket);
  const parsedCylinders = cylinders.map(({ id, label, weight }) => ({ id, ...(label.trim() ? { label: label.trim() } : {}), fullWeightKg: parseDecimal(weight) ?? 0 }));
  const weights = { ...(envelopeKg === undefined ? {} : { envelopeKg }), ...(burnerKg === undefined ? {} : { burnerKg }), ...(basketKg === undefined ? {} : { basketKg }), fullCylinders: parsedCylinders };
  const total = calculateBalloonWeight(weights);
  const mlmBalloon: Balloon = { id: balloon?.id ?? "new", registration, manufacturer, model, category, volumeM3: volumeM3 ?? 0, applicableMtowKg, configurationLimitsConfirmed, weights, documents: [] };
  const mlmModelKey = balloonMlmModelKey(mlmBalloon);
  const mlmRules = balloonMlmRules(mlmBalloon);
  const mlmProposal = balloonMlmProposal(mlmBalloon);
  const mlmRelevant = mlmDraft?.modelKey === mlmModelKey;
  const mlmRule = mlmRules.find(r => balloonMlmRuleKey(r) === (mlmRelevant ? mlmDraft?.ruleKey : undefined)) ?? mlmProposal;
  const mlmValueText = mlmRelevant && mlmText !== undefined ? mlmText : mlmProposal ? String(mlmProposal.value) : "";
  const mlmReference = mlmRelevant ? mlmDraft!.reference : mlmRule ? `${mlmRule.source.file} ; ${mlmRule.source.edition} ; §${mlmRule.source.sections} ; pages ${mlmRule.source.pages.join(", ")}` : "";
  const mlmRecord: BalloonMinimumLandingMass | undefined = parseDecimal(mlmValueText) !== undefined && parseDecimal(mlmValueText)! > 0 ? {
    valueKg: parseDecimal(mlmValueText)!, modelKey: mlmModelKey, ruleKey: mlmRule ? balloonMlmRuleKey(mlmRule) : "", reference: mlmReference,
    confirmed: mlmRelevant && mlmDraft!.confirmed, confirmationKey: mlmRelevant ? mlmDraft!.confirmationKey : undefined,
  } : undefined;
  const mlmSignature = mlmRecord ? balloonMlmConfirmationKey(mlmBalloon, mlmRecord) : "";
  const mlmConfirmed = !!mlmRecord && balloonMinimumLandingMass({ ...mlmBalloon, minimumLandingMass: mlmRecord }).confirmed;
  useEffect(() => {
    setMlmDraft(current => current?.confirmed && current.confirmationKey !== mlmSignature ? { ...current, confirmed: false, confirmationKey: undefined } : current);
  }, [mlmSignature]);
  const editMlm = (patch: Partial<BalloonMinimumLandingMass>, text = mlmValueText) => {
    setMlmText(text); setMlmDraft({ valueKg: parseDecimal(text) ?? 0, modelKey: mlmModelKey, ruleKey: mlmRule ? balloonMlmRuleKey(mlmRule) : "", reference: mlmReference, ...patch, confirmed: false });
  };

  const valid = Boolean(registration.trim() && manufacturer && model && volumeM3 && volumeM3 > 0 && total !== null && (!mlmValueText.trim() || (parseDecimal(mlmValueText) !== undefined && parseDecimal(mlmValueText)! > 0)));
  const chooseManufacturer = (choice: string) => { setManufacturerChoice(choice); setModelChoice(""); setManualModel(""); setVolumeFromCatalog(false); setSelectedMtomOptionId(""); setConfigurationLimitsConfirmed(false); if (mtomFromCatalog) { setApplicableMtow(""); setMtomFromCatalog(false); } if (choice !== OTHER) setManualManufacturer(""); };
  const chooseModel = (choice: string) => {
    setModelChoice(choice);
    setVolumeFromCatalog(false);
    setSelectedMtomOptionId("");
    setConfigurationLimitsConfirmed(false);
    if (choice === OTHER) return;
    setManualModel("");
    const knownVolume = catalogVolume(manufacturerChoice, choice);
    if (knownVolume !== null) { setVolume(String(knownVolume)); setVolumeFromCatalog(true); }
    const transition = mtomAfterModelChange(applicableMtow, mtomFromCatalog, manufacturerChoice, choice);
    setApplicableMtow(transition.value);
    setMtomFromCatalog(transition.fromCatalog);
  };
  const chooseMtomOption = (optionId: string) => {
    setSelectedMtomOptionId(optionId);
    setConfigurationLimitsConfirmed(false);
    if (!optionId || optionId === OTHER) {
      if (mtomFromCatalog) setApplicableMtow("");
      setMtomFromCatalog(false);
      return;
    }
    const option = mtomCatalogEntry?.options.find((candidate) => candidate.id === optionId);
    if (!option) return;
    setApplicableMtow(String(option.mtomKg));
    setMtomFromCatalog(true);
  };
  const addCylinder = () => { const id = `cylinder-${Date.now()}-${cylinders.length + 1}`; setCylinders((current) => [...current, { id, label: `Cylindre ${current.length + 1}`, weight: "" }]); setFocusCylinderId(id); };
  return <form className={styles.balloonForm} aria-busy={!hydrationReady} onSubmit={(event) => { event.preventDefault(); if (!canSubmitHydratedBalloonForm(hydrationReady, valid) || volumeM3 === undefined) return; onSubmit({ registration, manufacturer, model, category, volumeM3, weights, minimumLandingMass: mlmRecord, ...(applicableMtowKg === undefined ? {} : { applicableMtowKg }), configurationLimitsConfirmed, ...(color.trim() ? { color } : {}) }); }}>
    <details className={styles.formSection} open={identityOpen} onToggle={(event) => setIdentityOpen(event.currentTarget.open)}>
      <summary>Identité <ChevronDown size={17} aria-hidden /></summary>
      <div className={styles.sectionGrid}>
        <label className={styles.balloonFormWide}><span>Immatriculation</span><input autoFocus autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase().replace(/\s/g, ""))} /></label>
        <label><span>Fabricant</span><select value={manufacturerChoice} onChange={(e) => chooseManufacturer(e.target.value)}><option value="">Choisir</option>{catalogManufacturers().map((item) => <option key={item}>{item}</option>)}<option value={OTHER}>Autre fabricant</option></select></label>
        {manufacturerChoice === OTHER && <label><span>Fabricant libre</span><input value={manualManufacturer} onChange={(e) => { setManualManufacturer(e.target.value); setConfigurationLimitsConfirmed(false); }} /></label>}
        {manufacturerChoice && manufacturerChoice !== OTHER && <label><span>Modèle / type</span><select value={modelChoice} onChange={(e) => chooseModel(e.target.value)}><option value="">Choisir</option>{catalogModels(manufacturer).map((item) => <option key={item.model} value={item.model}>{catalogModelDisplayName(manufacturer, item.model)}{item.legacyUndocumented ? " — ancien, non documenté" : ""}</option>)}<option value={OTHER}>Autre modèle</option></select></label>}
        {(manufacturerChoice === OTHER || modelChoice === OTHER) && <label><span>Modèle / type</span><input value={manualModel} onChange={(e) => { setManualModel(e.target.value); setConfigurationLimitsConfirmed(false); }} /></label>}
        {catalogDocumentation?.documentation && <p className={styles.balloonFormWide}><small className={styles.catalogHint}>Manuel Cameron, Tables 2 et 5 : {catalogDocumentation.documentation.volumeCuFt.toLocaleString("fr-FR")} ft³ · MTOM standard {catalogDocumentation.documentation.standardMtomKg.toLocaleString("fr-FR")} kg · réduite {catalogDocumentation.documentation.reducedMtomKg.toLocaleString("fr-FR")} kg · MLM {catalogDocumentation.documentation.minimumLandingMassKg === null ? "non indiquée" : `${catalogDocumentation.documentation.minimumLandingMassKg.toLocaleString("fr-FR")} kg`}. Limites applicables selon la configuration et le manuel individuel.</small></p>}
        {catalogDocumentation?.legacyUndocumented && <p className={styles.balloonFormWide}><small className={styles.catalogHint}>Ancienne référence conservée. Modèle exact non documenté dans la Table 5 de cette édition du manuel ; caractéristiques à vérifier.</small></p>}
        <label className={styles.balloonFormWide}><span>Volume</span><span className={styles.technicalInput}><input inputMode="decimal" value={volume} onChange={(e) => { setVolume(decimalInput(e.target.value)); setVolumeFromCatalog(false); }} /><i>m³</i></span>{volumeFromCatalog && <small className={styles.catalogHint}>Volume issu du catalogue constructeur — modifiable</small>}</label>
      </div>
    </details>
    <details className={styles.formSection} open={massesOpen} onToggle={(event) => setMassesOpen(event.currentTarget.open)}>
      <summary>Configuration et masses <ChevronDown size={17} aria-hidden /></summary>
      <div className={styles.massGrid}><label><span>Enveloppe</span><span className={styles.technicalInput}><input inputMode="decimal" value={envelope} onChange={(e) => setEnvelope(decimalInput(e.target.value))} /><i>kg</i></span></label><label><span>Brûleur</span><span className={styles.technicalInput}><input inputMode="decimal" value={burner} onChange={(e) => setBurner(decimalInput(e.target.value))} /><i>kg</i></span></label><label><span>Nacelle</span><span className={styles.technicalInput}><input inputMode="decimal" value={basket} onChange={(e) => setBasket(decimalInput(e.target.value))} /><i>kg</i></span></label></div>
      <h3>Cylindres pleins</h3><div className={styles.cylinderList}>{cylinders.map((cylinder) => <div className={styles.cylinderRow} key={cylinder.id}><input aria-label="Nom du cylindre" value={cylinder.label} onChange={(e) => setCylinders((current) => current.map((item) => item.id === cylinder.id ? { ...item, label: e.target.value } : item))} /><span className={styles.technicalInput}><input ref={(node) => { if (node) cylinderInputs.current.set(cylinder.id, node); else cylinderInputs.current.delete(cylinder.id); }} aria-label={`Poids plein de ${cylinder.label || "ce cylindre"}`} inputMode="decimal" value={cylinder.weight} onChange={(e) => setCylinders((current) => current.map((item) => item.id === cylinder.id ? { ...item, weight: decimalInput(e.target.value) } : item))} /><i>kg</i></span><button type="button" aria-label={`Supprimer ${cylinder.label || "le cylindre"}`} onClick={() => setCylinders((current) => current.filter((item) => item.id !== cylinder.id))}><Trash2 size={17} /></button></div>)}</div><button className={styles.addCylinder} type="button" onClick={addCylinder}><Plus size={17} /> Ajouter un cylindre</button>
      <div className={styles.totalWeight}><span>Poids total du ballon</span><strong>{total === null ? "— kg" : `${total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`}</strong>{total === null && <small>Complétez les masses pour calculer le poids total.</small>}</div>
    </details>
    <details className={styles.formSection} open={limitsOpen} onToggle={(event) => setLimitsOpen(event.currentTarget.open)}>
      <summary>Limites <ChevronDown size={17} aria-hidden /></summary>
      <div className={styles.sectionGrid}>
        {hasSeveralApplicableLimits && <label className={styles.balloonFormWide}><span>Limite applicable</span><select value={selectedMtomOptionId} onChange={(event) => chooseMtomOption(event.target.value)}><option value="">Choisir dans le manuel</option>{mtomCatalogEntry?.options.map((option) => <option key={option.id} value={option.id}>{option.label} — {option.mtomKg.toLocaleString("fr-FR")} kg</option>)}{mtomCatalogEntry?.aircraftSpecificReducedLimitPossible && <option value={OTHER}>RMTOW propre au ballon — saisie manuelle</option>}</select><small className={styles.catalogHint}>Plusieurs limites possibles — vérifier le manuel du ballon.</small></label>}
        <label className={styles.balloonFormWide}><span>MTOM applicable</span><span className={styles.technicalInput}><input inputMode="decimal" value={applicableMtow} onChange={(e) => { const transition = mtomAfterManualChange(decimalInput(e.target.value)); setApplicableMtow(transition.value); setMtomFromCatalog(transition.fromCatalog); setSelectedMtomOptionId(""); setConfigurationLimitsConfirmed(transition.configurationLimitsConfirmed); }} /><i>kg</i></span>{mtomFromCatalog && <small className={styles.catalogHint}>Valeur proposée depuis le catalogue constructeur — modifiable</small>}{manufacturer && model && !mtomCatalogEntry && <small className={styles.catalogHint}>À renseigner depuis le manuel de vol.</small>}<small className={styles.catalogHint}>À confirmer avec le manuel de vol du ballon.</small></label>
        <label className={styles.balloonFormWide}><span>Masse minimale à l’atterrissage (kg)</span><input inputMode="decimal" value={mlmValueText} onChange={event => editMlm({}, decimalInput(event.target.value))} /><small className={styles.catalogHint}>{mlmProposal ? `Valeur constructeur proposée : ${mlmProposal.value.toLocaleString("fr-FR")} kg — à confirmer pour ce ballon.` : "Minimum constructeur à vérifier. Aucune valeur déduite de la MTOM."}</small></label>
        {mlmRules.length > 0 && <label className={styles.balloonFormWide}><span>Manuel et variante applicables</span><select value={mlmRule ? balloonMlmRuleKey(mlmRule) : ""} onChange={event => { const rule = mlmRules.find(r => balloonMlmRuleKey(r) === event.target.value); if (rule) editMlm({ ruleKey: balloonMlmRuleKey(rule), reference: `${rule.source.file} ; ${rule.source.edition} ; §${rule.source.sections} ; pages ${rule.source.pages.join(", ")}` }, mlmValueText.trim() ? mlmValueText : String(rule.value)); }}><option value="">Choisir le manuel applicable</option>{mlmRules.map(rule => <option key={balloonMlmRuleKey(rule)} value={balloonMlmRuleKey(rule)}>{rule.variant} — {rule.source.edition} — {rule.value} kg</option>)}</select><small className={styles.catalogHint}>{mlmRule?.conditions.join(" ")}</small></label>}
        <label className={styles.balloonFormWide}><span>Référence de la vérification MLM</span><input value={mlmReference} onChange={event => editMlm({ reference: event.target.value })} /></label>
        <label className={styles.balloonFormWide}><span className={styles.confirmationField}><input type="checkbox" checked={mlmConfirmed} disabled={!mlmRecord || !mlmRule || mlmRule.volumeM3 !== volumeM3 || !mlmReference.trim()} onChange={event => { if (mlmRecord) { setMlmText(mlmValueText); setMlmDraft({ ...mlmRecord, confirmed: event.target.checked, confirmationKey: event.target.checked ? mlmSignature : undefined }); } }} /><span>J’ai vérifié cette masse minimale, le modèle, la variante, l’édition et les suppléments applicables à la configuration réelle, en exploitation normale. Aucun supplément ne modifie cette limite.</span></span><small className={styles.catalogHint}>Une modification de configuration ou de référence annule la confirmation. Cette vérification ne valide pas globalement le vol.</small></label>
        <label className={styles.balloonFormWide}><span>Limites vérifiées</span><span className={styles.confirmationField}><input type="checkbox" checked={configurationLimitsConfirmed} onChange={(event) => setConfigurationLimitsConfirmed(event.target.checked)} /><span>J’ai vérifié la MTOM et la configuration de ce ballon avec son manuel de vol.</span></span></label>
      </div>
    </details>
    <details className={styles.formSection}>
      <summary>Détails facultatifs <ChevronDown size={17} aria-hidden /></summary>
      <div className={styles.sectionGrid}><label><span>Catégorie</span><select value={category} onChange={(e) => setCategory(e.target.value as BalloonCategory)}><option>Libre à air chaud</option><option>Libre à gaz</option></select></label><label><span>Couleur</span><input value={color} onChange={(e) => setColor(e.target.value)} /></label></div>
    </details>
    {submissionError && <p role="alert">{submissionError}</p>}<div className={styles.balloonFormActions}><button type="submit" disabled={!canSubmitHydratedBalloonForm(hydrationReady, valid)}>{hydrationReady ? submitLabel : "Chargement…"}</button><button type="button" className={styles.later} onClick={onCancel}>Annuler</button></div>
  </form>;
}
