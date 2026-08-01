"use client";
import { useState } from "react";
import type { Balloon, BalloonCategory, BalloonInput } from "../../lib/balloons";
import styles from "../../more/More.module.css";

type Props = { balloon?: Balloon; submitLabel: string; onSubmit: (input: BalloonInput) => void; onCancel: () => void };
function numeric(value: string): number | undefined { return value === "" ? undefined : Number(value); }
export default function BalloonForm({ balloon, submitLabel, onSubmit, onCancel }: Props) {
  const [registration, setRegistration] = useState(balloon?.registration ?? "");
  const [manufacturer, setManufacturer] = useState(balloon?.manufacturer ?? "");
  const [model, setModel] = useState(balloon?.model ?? "");
  const [category, setCategory] = useState<BalloonCategory>(balloon?.category ?? "Libre à air chaud");
  const [volume, setVolume] = useState(balloon ? String(balloon.volumeM3) : "");
  const [emptyWeight, setEmptyWeight] = useState(balloon?.emptyWeightKg === undefined ? "" : String(balloon.emptyWeightKg));
  const [maximumWeight, setMaximumWeight] = useState(balloon?.maximumAuthorizedWeightKg === undefined ? "" : String(balloon.maximumAuthorizedWeightKg));
  const [occupants, setOccupants] = useState(balloon?.maximumOccupants === undefined ? "" : String(balloon.maximumOccupants));
  const [cylinders, setCylinders] = useState(balloon?.cylinderCount === undefined ? "" : String(balloon.cylinderCount));
  const [fuelCapacity, setFuelCapacity] = useState(balloon?.totalFuelCapacity === undefined ? "" : String(balloon.totalFuelCapacity));
  const [color, setColor] = useState(balloon?.color ?? "");
  const volumeM3 = numeric(volume); const emptyWeightKg = numeric(emptyWeight); const maximumAuthorizedWeightKg = numeric(maximumWeight);
  const valid = Boolean(registration.trim() && manufacturer.trim() && model.trim() && category && volumeM3 && volumeM3 > 0 && emptyWeightKg !== undefined && emptyWeightKg >= 0 && maximumAuthorizedWeightKg !== undefined && maximumAuthorizedWeightKg > 0);
  const digits = (value: string) => value.replace(/\D/g, "");
  return <form className={styles.balloonForm} onSubmit={(event) => { event.preventDefault(); if (!valid || volumeM3 === undefined || emptyWeightKg === undefined || maximumAuthorizedWeightKg === undefined) return; onSubmit({ registration, manufacturer, model, category, volumeM3, emptyWeightKg, maximumAuthorizedWeightKg, ...(numeric(occupants) === undefined ? {} : { maximumOccupants: numeric(occupants) }), ...(numeric(cylinders) === undefined ? {} : { cylinderCount: numeric(cylinders) }), ...(numeric(fuelCapacity) === undefined ? {} : { totalFuelCapacity: numeric(fuelCapacity) }), ...(color.trim() ? { color } : {}) }); }}>
    <label><span>Immatriculation</span><input autoFocus autoCapitalize="characters" value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase().replace(/\s/g, ""))} /></label>
    <label><span>Constructeur</span><input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></label>
    <label><span>Modèle / type</span><input value={model} onChange={(e) => setModel(e.target.value)} /></label>
    <label><span>Catégorie</span><select value={category} onChange={(e) => setCategory(e.target.value as BalloonCategory)}><option>Libre à air chaud</option><option>Libre à gaz</option></select></label>
    <label><span>Volume (m³)</span><input inputMode="numeric" value={volume} onChange={(e) => setVolume(digits(e.target.value))} /></label>
    <label><span>Masse à vide (kg)</span><input inputMode="numeric" value={emptyWeight} onChange={(e) => setEmptyWeight(digits(e.target.value))} /></label>
    <label><span>Masse maximale (kg)</span><input inputMode="numeric" value={maximumWeight} onChange={(e) => setMaximumWeight(digits(e.target.value))} /></label>
    <label><span>Occupants max. (facultatif)</span><input inputMode="numeric" value={occupants} onChange={(e) => setOccupants(digits(e.target.value))} /></label>
    <label><span>Bouteilles (facultatif)</span><input inputMode="numeric" value={cylinders} onChange={(e) => setCylinders(digits(e.target.value))} /></label>
    <label><span>Capacité carburant (facultatif)</span><input inputMode="numeric" value={fuelCapacity} onChange={(e) => setFuelCapacity(digits(e.target.value))} /></label>
    <label className={styles.balloonFormWide}><span>Couleur (facultatif)</span><input value={color} onChange={(e) => setColor(e.target.value)} /></label>
    <div className={styles.actions} style={{ gridColumn: "1 / -1" }}><button type="submit" disabled={!valid}>{submitLabel}</button><button type="button" className={styles.later} onClick={onCancel}>Annuler</button></div>
  </form>;
}
