import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import NavigationBar from "../../../components/NavigationBar";
import AscensionTitle from "../../../components/journal/AscensionTitle";
import CompletionAscensionDetail from "../../../components/journal/CompletionAscensionDetail";
import {
  ASCENSIONS,
  formatOfficialDuration,
  getAscension,
  getAscensionAutomaticName,
} from "../../../lib/ascensionMockData";
import styles from "../../Journal.module.css";
import { DEMO_COMPLETION_ASCENSION_ID } from "../../../lib/flightCompletion";

export function generateStaticParams() {
  return [...ASCENSIONS.map(({ id }) => ({ id })), { id: DEMO_COMPLETION_ASCENSION_ID }];
}

export default async function AscensionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ascension = getAscension(id);
  if (!ascension) {
    return (
      <main className={styles.screen}>
        <div className={styles.layout}>
          <Link href="/journal" className={styles.backLink}><ChevronLeft size={18} aria-hidden="true" /> Carnet</Link>
          <CompletionAscensionDetail ascensionId={id} />
        </div>
        <NavigationBar activeItem="Journal" />
      </main>
    );
  }

  const fields = [
    ["Date", ascension.date],
    ["Type de ballon", `${ascension.balloonModel} · ${ascension.balloonType}`],
    ["Immatriculation", ascension.registration],
    ["Lieu d’envol", ascension.departure],
    ["Lieu d’atterrissage", ascension.arrival],
    ["Fonction", ascension.function],
    ["Vol de nuit", ascension.flightType === "Nuit" ? "Oui" : "Non"],
    ["Altitude atteinte", ascension.maximumAltitudeM === null ? "—" : `${ascension.maximumAltitudeM.toLocaleString("fr-FR")} m`],
    ["Temps officiel", formatOfficialDuration(ascension.officialDurationMinutes)],
  ] as const;

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <Link href="/journal" className={styles.backLink}>
          <ChevronLeft size={18} aria-hidden="true" /> Carnet
        </Link>
        <header className={styles.detailHeader}>
          <p className={styles.eyebrow}>Ascension</p>
          <div className={styles.ascensionDetailTitleRow}>
            <AscensionTitle
              ascensionId={ascension.id}
              automaticTitle={getAscensionAutomaticName(ascension)}
              availableIds={ASCENSIONS.map(({ id: availableId }) => availableId)}
              className={styles.routeTitle}
            />
            <Link className={styles.ascensionEditLink} href={`/journal/ascension/${ascension.id}/edit`}>Modifier</Link>
          </div>
        </header>

        <section className={styles.ascensionDetailGrid} aria-label="Informations officielles">
          {fields.map(([label, value]) => (
            <article key={label} className={styles.ascensionDetailCard}>
              <p>{label}</p>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
        <article className={styles.ascensionObservation}>
          <p>Observations</p>
          <strong>{ascension.observations || "—"}</strong>
        </article>
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}
