"use client";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { catalogManufacturers, catalogModels, catalogVolume } from "../../lib/balloonCatalog";
import { calculateBalloonWeight, type Balloon, type BalloonCategory, type BalloonInput } from "../../lib/balloons";
import { proposedApplicableMtowKg } from "../../lib/loadPerformance/modelParameters/mtomCatalog";
import styles from "../../more/More.module.css";

const OTHER = "__other__";
type CylinderDraft = { id: string; label: string; weight: string };
type Props = { balloon?: Balloon; submitLabel: string; onSubmit: (input: BalloonInput) => void; onCancel: () => void };
function parseDecimal(value: string): number | undefined { if (!value.trim()) return undefined; const number = Number(value.replace(",", ".")); return Number.isFinite(number) ? number : undefined; }
function decimalInput(value: string): string { return value.replace(/[^0-9.,]/g, "").replace(/([.,].*)[.,]/g, "$1"); }
export default function BalloonForm({ balloon, submitLabel, onSubmit, onCancel }: Props) {
  const knownManufacturer = balloon && catalogManufacturers().includes(balloon.manufacturer);
  const knownModel = balloon && catalogModels(balloon.manufacturer).some(({ model }) => model === balloon.model);
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
  const [configurationLimitsConfirmed, setConfigurationLimitsConfirmed] = useState(balloon?.configurationLimitsConfirmed === true);
  const [envelope, setEnvelope] = useState(balloon?.weights.envelopeKg === undefined ? "" : String(balloon.weights.envelopeKg));
  const [burner, setBurner] = useState(balloon?.weights.burnerKg === undefined ? "" : String(balloon.weights.burnerKg));
  const [basket, setBasket] = useState(balloon?.weights.basketKg === undefined ? "" : String(balloon.weights.basketKg));
  const [cylinders, setCylinders] = useState<CylinderDraft[]>(balloon?.weights.fullCylinders.map(({ id, label, fullWeightKg }) => ({ id, label: label ?? "", weight: String(fullWeightKg) })) ?? []);
  const [color, setColor] = useState(balloon?.color ?? "");
  const [focusCylinderId, setFocusCylinderId] = useState<string | null>(null);
  const cylinderInputs = useRef(new Map<string, HTMLInputElement>());
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
  const volumeM3 = parseDecimal(volume); const parsedApplicableMtowKg = parseDecimal(applicableMtow); const applicableMtowKg = parsedApplicableMtowKg && parsedApplicableMtowKg > 0 ? parsedApplicableMtowKg : undefined; const envelopeKg = parseDecimal(envelope); const burnerKg = parseDecimal(burner); const basketKg = parseDecimal(basket);
  const parsedCylinders = cylinders.map(({ id, label, weight }) => ({ id, ...(label.trim() ? { label: label.trim() } : {}), fullWeightKg: parseDecimal(weight) ?? 0 }));
  const weights = { ...(envelopeKg === undefined ? {} : { envelopeKg }), ...(burnerKg === undefined ? {} : { burnerKg }), ...(basketKg === undefined ? {} : { basketKg }), fullCylinders: parsedCylinders };
  const total = calculateBalloonWeight(weights);
  const valid = Boolean(registration.trim() && manufacturer && model && volumeM3 && volumeM3 > 0 && total !== null);
  const chooseManufacturer = (choice: string) => { setManufacturerChoice(choice); setModelChoice(""); setManualModel(""); setVolumeFromCatalog(false); setConfigurationLimitsConfirmed(false); if (mtomFromCatalog) { setApplicableMtow(""); setMtomFromCatalog(false); } if (choice !== OTHER) setManualManufacturer(""); };
  const chooseModel = (choice: string) => {
    setModelChoice(choice);
    setVolumeFromCatalog(false);
    setConfigurationLimitsConfirmed(false);
    if (choice === OTHER) return;
    setManualModel("");
    const knownVolume = catalogVolume(manufacturerChoice, choice);
    if (knownVolume !== null) { setVolume(String(knownVolume)); setVolumeFromCatalog(true); }
    const hasPilotMtow = Boolean(applicableMtow.trim()) && !mtomFromCatalog;
    if (mtomFromCatalog) { setApplicableMtow(""); setMtomFromCatalog(false); }
    if (!hasPilotMtow) {
      const proposedMtow = proposedApplicableMtowKg(manufacturerChoice, choice);
      if (proposedMtow !== null) { setApplicableMtow(String(proposedMtow)); setMtomFromCatalog(true); }
    }
  };
  const addCylinder = () => { const id = `cylinder-${Date.now()}-${cylinders.length + 1}`; setCylinders((current) => [...current, { id, label: `Cylindre ${current.length + 1}`, weight: "" }]); setFocusCylinderId(id); };
  return <form className={styles.balloonForm} onSubmit={(event) => { event.preventDefault(); if (!valid || volumeM3 === undefined) return; onSubmit({ registration, manufacturer, model, category, volumeM3, weights, ...(applicableMtowKg === undefined ? {} : { applicableMtowKg }), configurationLimitsConfirmed, ...(color.trim() ? { color } : {}) }); }}>
    <label><span>Immatriculation</span><input autoFocus autoCapitalize="characters" value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase().replace(/\s/g, ""))} /></label>
    <label><span>Fabricant</span><select value={manufacturerChoice} onChange={(e) => chooseManufacturer(e.target.value)}><option value="">Choisir</option>{catalogManufacturers().map((item) => <option key={item}>{item}</option>)}<option value={OTHER}>Autre fabricant</option></select></label>
    {manufacturerChoice === OTHER && <label><span>Fabricant libre</span><input value={manualManufacturer} onChange={(e) => setManualManufacturer(e.target.value)} /></label>}
    {manufacturerChoice && manufacturerChoice !== OTHER && <label><span>Modèle / type</span><select value={modelChoice} onChange={(e) => chooseModel(e.target.value)}><option value="">Choisir</option>{catalogModels(manufacturer).map((item) => <option key={item.model}>{item.model}</option>)}<option value={OTHER}>Autre modèle</option></select></label>}
    {(manufacturerChoice === OTHER || modelChoice === OTHER) && <label><span>Modèle / type</span><input value={manualModel} onChange={(e) => setManualModel(e.target.value)} /></label>}
    <label><span>Volume</span><span className={styles.technicalInput}><input inputMode="decimal" value={volume} onChange={(e) => { setVolume(decimalInput(e.target.value)); setVolumeFromCatalog(false); }} /><i>m³</i></span>{volumeFromCatalog && <small className={styles.catalogHint}>Volume issu du catalogue constructeur — modifiable</small>}</label>
    <label><span>MTOM applicable</span><span className={styles.technicalInput}><input inputMode="decimal" value={applicableMtow} onChange={(e) => { setApplicableMtow(decimalInput(e.target.value)); setMtomFromCatalog(false); setConfigurationLimitsConfirmed(false); }} /><i>kg</i></span>{mtomFromCatalog && <small className={styles.catalogHint}>Valeur proposée depuis le catalogue constructeur — modifiable</small>}<small className={styles.catalogHint}>À confirmer avec le manuel de vol du ballon.</small></label>
    <label className={styles.balloonFormWide}>
      <span>Limites vérifiées avec le manuel de vol</span>
      <span className={styles.confirmationField}><input type="checkbox" checked={configurationLimitsConfirmed} onChange={(event) => setConfigurationLimitsConfirmed(event.target.checked)} /><span>J’ai vérifié la MTOM et la configuration de ce ballon avec son manuel de vol.</span></span>
    </label>
    <label><span>Catégorie</span><select value={category} onChange={(e) => setCategory(e.target.value as BalloonCategory)}><option>Libre à air chaud</option><option>Libre à gaz</option></select></label>
    <label className={styles.balloonFormWide}><span>Couleur (facultatif)</span><input value={color} onChange={(e) => setColor(e.target.value)} /></label>
    <fieldset className={styles.massSection}><legend>Masses du ballon</legend>
      <div className={styles.massGrid}><label><span>Enveloppe</span><span className={styles.technicalInput}><input inputMode="decimal" value={envelope} onChange={(e) => setEnvelope(decimalInput(e.target.value))} /><i>kg</i></span></label><label><span>Brûleur</span><span className={styles.technicalInput}><input inputMode="decimal" value={burner} onChange={(e) => setBurner(decimalInput(e.target.value))} /><i>kg</i></span></label><label><span>Nacelle</span><span className={styles.technicalInput}><input inputMode="decimal" value={basket} onChange={(e) => setBasket(decimalInput(e.target.value))} /><i>kg</i></span></label></div>
      <h3>Cylindres pleins</h3><div className={styles.cylinderList}>{cylinders.map((cylinder) => <div className={styles.cylinderRow} key={cylinder.id}><input aria-label="Nom du cylindre" value={cylinder.label} onChange={(e) => setCylinders((current) => current.map((item) => item.id === cylinder.id ? { ...item, label: e.target.value } : item))} /><span className={styles.technicalInput}><input ref={(node) => { if (node) cylinderInputs.current.set(cylinder.id, node); else cylinderInputs.current.delete(cylinder.id); }} aria-label={`Poids plein de ${cylinder.label || "ce cylindre"}`} inputMode="decimal" value={cylinder.weight} onChange={(e) => setCylinders((current) => current.map((item) => item.id === cylinder.id ? { ...item, weight: decimalInput(e.target.value) } : item))} /><i>kg</i></span><button type="button" aria-label={`Supprimer ${cylinder.label || "le cylindre"}`} onClick={() => setCylinders((current) => current.filter((item) => item.id !== cylinder.id))}><Trash2 size={17} /></button></div>)}</div><button className={styles.addCylinder} type="button" onClick={addCylinder}><Plus size={17} /> Ajouter un cylindre</button>
      <div className={styles.totalWeight}><span>Poids total du ballon</span><strong>{total === null ? "— kg" : `${total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`}</strong>{total === null && <small>Complétez les masses pour calculer le poids total.</small>}</div>
    </fieldset>
    <div className={styles.actions} style={{ gridColumn: "1 / -1" }}><button type="submit" disabled={!valid}>{submitLabel}</button><button type="button" className={styles.later} onClick={onCancel}>Annuler</button></div>
  </form>;
}
