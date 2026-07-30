"use client";

import { Balloon } from "lucide-react";
import type { HeroRingData } from "./types";
import styles from "./Cockpit.module.css";

const RING_RADIUS = 151;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type HeroRingProps = {
  data: HeroRingData;
};

export default function HeroRing({ data }: HeroRingProps) {
  // One flight hour advances the compass arc by one degree.
  const ringAngle = data.totalHours % 360;
  const ringArcLength = (ringAngle / 360) * RING_CIRCUMFERENCE;

  return (
    <section className={styles.hero} aria-label="Expérience de vol">
      <div className={styles.ringInstrument}>
        <svg
          className={styles.ringBackdrop}
          viewBox="0 0 560 370"
          aria-hidden="true"
        >
          <g className={styles.ringBackdropBase}>
            <path d="M94 91 A220 151 0 0 1 466 91" />
            <path d="M79 275 A238 164 0 0 0 481 275" />
          </g>
          <g className={styles.ringRadials}>
            <path d="M280 17 V36 M280 334 V353 M92 185 H114 M446 185 H468" />
          </g>
          <g className={styles.ringSideStructures}>
            <path
              className={styles.ringSideMass}
              d="M28 185 H122 M438 185 H532"
            />
            <path
              className={styles.ringSideInset}
              d="M62 174 H130 M430 196 H498"
            />
          </g>
        </svg>
        <svg
          className={styles.ringDial}
          viewBox="0 0 400 400"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="hero-ring-depth" cx="50%" cy="44%" r="58%">
              <stop
                offset="0%"
                stopColor="var(--bc-color-canvas-elevated)"
              />
              <stop
                offset="72%"
                stopColor="var(--bc-color-canvas-elevated)"
              />
              <stop offset="100%" stopColor="var(--bc-color-canvas)" />
            </radialGradient>
            <radialGradient id="flight-instrument-plate" cx="50%" cy="46%" r="58%">
              <stop offset="0%" stopColor="var(--bc-color-canvas-elevated)" />
              <stop offset="78%" stopColor="var(--bc-color-night)" />
              <stop offset="100%" stopColor="var(--bc-color-canvas)" />
            </radialGradient>
          </defs>
          <circle
            className={styles.ringPlate}
            cx="200"
            cy="200"
            r="191"
            style={{ fill: "url(#flight-instrument-plate)" }}
          />
          <circle className={styles.ringBezelOuter} cx="200" cy="200" r="184" />
          <circle className={styles.ringBezel} cx="200" cy="200" r="176" />
          <circle className={styles.ringOuter} cx="200" cy="200" r="181" />
          {Array.from({ length: 72 }, (_, index) => {
            const degrees = index * 5;
            const isCardinal = degrees % 90 === 0;
            const isStrong = degrees % 30 === 0;
            const isMedium = !isStrong && degrees % 10 === 0;

            return (
              <line
                className={
                  isCardinal
                    ? styles.ringCardinalTick
                    : isStrong
                    ? styles.ringStrongTick
                    : isMedium
                      ? styles.ringMediumTick
                      : styles.ringTick
                }
                key={degrees}
                x1="200"
                y1={
                  isCardinal ? "21" : isStrong ? "23" : isMedium ? "25" : "27"
                }
                x2="200"
                y2={
                  isCardinal ? "41" : isStrong ? "39" : isMedium ? "37" : "34"
                }
                transform={`rotate(${degrees} 200 200)`}
              />
            );
          })}
          <circle className={styles.ringCrown} cx="200" cy="200" r="166" />
          <circle className={styles.ringTrack} cx="200" cy="200" r="151" />
          <circle
            className={styles.ringAccent}
            cx="200"
            cy="200"
            r={RING_RADIUS}
            style={{
              strokeDasharray: `${ringArcLength} ${RING_CIRCUMFERENCE}`,
            }}
          />
          <circle
            className={styles.ringInner}
            cx="200"
            cy="200"
            r="124"
            style={{ fill: "url(#hero-ring-depth)" }}
          />
          <circle className={styles.ringInnerHalo} cx="200" cy="200" r="119" />

          <g className={styles.ringCardinals}>
            <text x="200" y="78">0</text>
            <text x="326" y="205">90</text>
            <text x="200" y="334">180</text>
            <text x="70" y="205">270</text>
          </g>
          <path className={styles.ringNorthMarker} d="M200 37 L194 50 H206 Z" />
        </svg>
        <div className={styles.ringContent}>
          <Balloon
            className={styles.ringBalloon}
            size={15}
            strokeWidth={1.6}
            aria-hidden="true"
          />
          <strong className={styles.ringValue}>{data.displayHours}</strong>
          <div className={styles.ringStats}>
            <strong>{data.flights}</strong> vols
          </div>
        </div>
      </div>
    </section>
  );
}
