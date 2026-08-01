"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addBalloon, NEW_BALLOON_RETURN_KEY, NEW_BALLOON_SELECTION_KEY } from "../../../../lib/balloonStorage";
import styles from "../../../More.module.css";

export default function NewBalloonPage() {
  const router = useRouter();
  const [registration, setRegistration] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [volume, setVolume] = useState("");
  const [color, setColor] = useState("");
  const volumeM3 = volume === "" ? Number.NaN : Number(volume);
  const valid = Boolean(registration.trim() && manufacturer.trim() && model.trim() && Number.isInteger(volumeM3) && volumeM3 > 0);
  const back = () => router.push(window.sessionStorage.getItem(NEW_BALLOON_RETURN_KEY) || "/journal/ascension/new");
  return <main className={styles.screen}><div className={styles.layout}>
    <button type="button" className={styles.back} onClick={back}><ChevronLeft size={18} aria-hidden="true" /> Ascension</button>
    <header><p className={styles.eyebrow}>Profil pilote</p><h1 className={styles.title}>Ajouter un ballon</h1><p className={styles.subtitle}>Le ballon sera immédiatement disponible dans la préparation et le carnet.</p></header>
    <form className={styles.balloonForm} onSubmit={(event) => { event.preventDefault(); if (!valid) return; const balloon = addBalloon({ registration, manufacturer, model, volumeM3, ...(color.trim() ? { color } : {}) }); window.sessionStorage.setItem(NEW_BALLOON_SELECTION_KEY, balloon.id); back(); }}>
      <label><span>Immatriculation</span><input autoFocus autoCapitalize="characters" value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase())} /></label>
      <label><span>Constructeur</span><input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></label>
      <label><span>Modèle</span><input value={model} onChange={(e) => setModel(e.target.value)} /></label>
      <label><span>Volume (m³)</span><input inputMode="numeric" pattern="[0-9]*" value={volume} onChange={(e) => setVolume(e.target.value.replace(/\D/g, ""))} /></label>
      <label className={styles.balloonFormWide}><span>Couleur (facultatif)</span><input value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <div className={styles.actions} style={{ gridColumn: "1 / -1" }}><button type="submit" disabled={!valid}>Enregistrer</button><button type="button" className={styles.later} onClick={back}>Annuler</button></div>
    </form>
  </div></main>;
}
