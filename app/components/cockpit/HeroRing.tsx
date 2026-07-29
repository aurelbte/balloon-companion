import type { HeroRingData } from "./types";
import styles from "./Cockpit.module.css";

type HeroRingProps = {
  data: HeroRingData;
};

export default function HeroRing({ data }: HeroRingProps) {
  return (
    <section className={styles.hero} aria-label="Expérience de vol">
      <div className={styles.ringInstrument}>
        <svg
          className={styles.ringDial}
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          <circle className={styles.ringOuter} cx="100" cy="100" r="91" />
          <circle className={styles.ringInner} cx="100" cy="100" r="76" />
          <circle className={styles.ringAccent} cx="100" cy="100" r="84" />
          {Array.from({ length: 36 }, (_, index) => (
            <line
              className={
                index % 9 === 0 ? styles.ringMajorTick : styles.ringTick
              }
              key={index}
              x1="100"
              y1={index % 9 === 0 ? "12" : "14"}
              x2="100"
              y2={index % 9 === 0 ? "20" : "18"}
              transform={`rotate(${index * 10} 100 100)`}
            />
          ))}
        </svg>
        <span className={styles.ringNorthMarker} aria-hidden="true" />
        <div className={styles.ringContent}>
          <strong className={styles.ringValue}>{data.totalHours}</strong>
          <span className={styles.ringUnit}>Heures de vol</span>
          <div className={styles.ringStats}>
            <span>
              <strong>{data.flights}</strong> Vols
            </span>
            <span aria-hidden="true">•</span>
            <span>
              <strong>{data.terrains}</strong> Terrains
            </span>
            <span aria-hidden="true">•</span>
            <span>
              <strong>{data.countries}</strong> Pays
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
