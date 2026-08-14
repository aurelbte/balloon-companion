"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import NavigationBar from "../../../components/NavigationBar";
import { useUnitPreferences } from "../../../contexts/UnitPreferencesContext";
import styles from "./units.module.css";

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange(value: T): void }) {
  return <div className={styles.row}><span>{label}</span><div className={styles.segmented} role="group" aria-label={label}>{options.map((option) => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{option}</button>)}</div></div>;
}

export default function UnitsPage() {
  const units = useUnitPreferences();
  return <main className={styles.screen}><div className={styles.layout}>
    <Link href="/more/settings" className={styles.back}><ChevronLeft size={18} /> Réglages</Link>
    <header><p>Réglages de l’app</p><h1>Unités</h1></header>
    <section><h2>Météo</h2>
      <Segmented label="Vent" value={units.weather.windSpeedUnit} options={["km/h", "kt"]} onChange={(windSpeedUnit) => units.updateUnitPreferences({ weather: { ...units.weather, windSpeedUnit } })} />
      <Segmented label="Température" value={units.weather.temperatureUnit} options={["°C", "°F"]} onChange={(temperatureUnit) => units.updateUnitPreferences({ weather: { ...units.weather, temperatureUnit } })} />
    </section>
    <section><h2>Instruments de vol</h2>
      <Segmented label="Vitesse" value={units.flightInstruments.speedUnit} options={["km/h", "kt"]} onChange={(speedUnit) => units.updateUnitPreferences({ flightInstruments: { ...units.flightInstruments, speedUnit } })} />
      <Segmented label="Altitude" value={units.flightInstruments.altitudeUnit} options={["m", "ft"]} onChange={(altitudeUnit) => units.updateUnitPreferences({ flightInstruments: { ...units.flightInstruments, altitudeUnit } })} />
      <Segmented label="Distance" value={units.flightInstruments.distanceUnit} options={["km", "NM"]} onChange={(distanceUnit) => units.updateUnitPreferences({ flightInstruments: { ...units.flightInstruments, distanceUnit } })} />
    </section>
    <p className={styles.note}>Les données aéronautiques officielles conservent leurs unités d’origine.</p>
  </div><NavigationBar activeItem="Plus" /></main>;
}
