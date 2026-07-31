"use client";

import { Balloon, ChevronDown } from "lucide-react";

export type PreparationBalloonOption = {
  id: string;
  registration: string;
  manufacturer: string;
  model: string;
};

type BalloonSelectorProps = {
  balloons: readonly PreparationBalloonOption[];
  selectedBalloonId: string;
  onChange: (balloonId: string) => void;
  onAddBalloon?: () => void;
};

export default function BalloonSelector({
  balloons,
  selectedBalloonId,
  onChange,
  onAddBalloon,
}: BalloonSelectorProps) {
  const selected = balloons.find(
    (balloon) => balloon.id === selectedBalloonId,
  );

  return (
    <section
      className="rounded-[24px] border p-3 sm:p-4"
      style={{
        background:
          "linear-gradient(145deg, var(--bc-color-surface), var(--bc-color-canvas-elevated))",
        borderColor: "var(--bc-border)",
        boxShadow: "var(--bc-shadow-panel)",
      }}
      aria-labelledby="balloon-selector-title"
    >
      <h2
        id="balloon-selector-title"
        className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--bc-color-text-muted)" }}
      >
        Ballon
      </h2>

      {balloons.length > 0 ? (
        <label
          className="relative flex min-h-12 items-center gap-3 rounded-2xl border px-3"
          style={{
            background: "rgb(255 255 255 / 3%)",
            borderColor: "var(--bc-border)",
          }}
        >
          <Balloon size={20} style={{ color: "var(--bc-accent)" }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold">
              {selected?.registration || "Non renseigné"}
            </span>
            <span
              className="mt-0.5 block truncate text-xs"
              style={{ color: "var(--bc-color-text-secondary)" }}
            >
              {selected
                ? `${selected.manufacturer} ${selected.model}`
                : "Sélection facultative"}
            </span>
          </span>
          <ChevronDown
            size={18}
            style={{ color: "var(--bc-color-text-muted)" }}
          />
          <select
            value={selectedBalloonId}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Choisir un ballon"
          >
            <option value="">Non renseigné</option>
            {balloons.map((balloon) => (
              <option key={balloon.id} value={balloon.id}>
                {balloon.registration} — {balloon.manufacturer} {balloon.model}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div>
          <p className="text-base font-semibold">Non renseigné</p>
          {onAddBalloon && (
            <button
              type="button"
              onClick={onAddBalloon}
              className="mt-2 text-sm font-semibold"
              style={{ color: "var(--bc-accent)" }}
            >
              Ajouter un ballon
            </button>
          )}
        </div>
      )}
    </section>
  );
}
