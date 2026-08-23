"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Scale, ShieldCheck, Tag } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import BalloonDocumentsCard from "../../../../components/balloons/BalloonDocumentsCard";
import { useBalloonRegistry } from "../../../../hooks/useBalloons";
import { balloonDocumentStorage } from "../../../../lib/balloonDocumentStorage";
import { balloonDisplayName, calculateBalloonEmptyWeight } from "../../../../lib/balloons";
import { deleteBalloon } from "../../../../lib/balloonStorage";
import styles from "../../../More.module.css";

export default function BalloonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const registry = useBalloonRegistry();
  const balloon = registry.balloons.find((item) => item.id === decodeURIComponent(id));

  if (!balloon) return <main className={styles.screen}><div className={styles.layout}><Link href="/more/profile/balloons" className={styles.back}><ChevronLeft size={18} /> Mes ballons</Link><p className={styles.subtitle}>Ballon introuvable.</p></div></main>;

  const editHref = `/more/profile/balloons/${encodeURIComponent(balloon.id)}/edit`;
  const total = calculateBalloonEmptyWeight(balloon);
  const cylinders = balloon.weights.fullCylinders.length;

  const removeBalloon = async () => {
    if (!window.confirm(`Supprimer ce ballon ?\n\nLe ballon ${balloonDisplayName(balloon)} sera retiré de votre profil.`)) return;
    try {
      const documentCount = await balloonDocumentStorage.countByBalloonId(balloon.id);
      if (documentCount > 0 && !window.confirm(`Ce ballon contient ${documentCount} document${documentCount > 1 ? "s" : ""} enregistré${documentCount > 1 ? "s" : ""} hors ligne.\n\nSupprimer le ballon et ses documents ?`)) return;
      if (documentCount > 0) await balloonDocumentStorage.deleteByBalloonId(balloon.id);
      if (await deleteBalloon(balloon.id)) {
        const targeted = new URLSearchParams(window.location.search).get("cloudSyncTest") === "targeted";
        router.push(`/more/profile/balloons${targeted ? "?cloudSyncTest=targeted" : ""}`);
      }
      else window.alert("La suppression n’a pas pu être enregistrée dans la file de synchronisation locale.");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "La suppression n’a pas pu être terminée.");
    }
  };

  return <main className={`${styles.screen} ${styles.balloonDetailScreen}`}><div className={`${styles.layout} ${styles.balloonDetailLayout}`}>
    <Link href="/more/profile/balloons" className={styles.back}><ChevronLeft size={18} /> Mes ballons</Link>
    <header className={styles.balloonDetailHeader}>
      <div><h1 className={styles.balloonRegistration}>{balloon.registration}</h1><p>{balloon.manufacturer} {balloon.model}</p>{registry.activeBalloonId === balloon.id && <span className={styles.activeBalloonBadge}>Ballon actif</span>}</div>
      <details className={styles.balloonOverflowMenu}><summary aria-label="Actions secondaires"><MoreHorizontal size={20} /></summary><div><button type="button" onClick={() => void removeBalloon()}>Supprimer le ballon</button></div></details>
    </header>

    <section className={styles.balloonSummaryGrid} aria-label="Synthèse du ballon">
      <Link href={editHref} className={styles.balloonSummaryCard}><Tag size={18} /><span><strong>Identité</strong><b>{balloon.manufacturer} {balloon.model}</b><small>{balloon.volumeM3.toLocaleString("fr-FR")} m³</small></span><ChevronRight size={16} /></Link>
      <Link href={editHref} className={styles.balloonSummaryCard}><Scale size={18} /><span><strong>Masse équipée</strong><b>{total === null ? "— kg" : `${total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`}</b><small>{cylinders} cylindre{cylinders > 1 ? "s" : ""}</small></span><ChevronRight size={16} /></Link>
      <Link href={editHref} className={styles.balloonSummaryCard}><ShieldCheck size={18} /><span><strong>Limites</strong><b>{balloon.applicableMtowKg === undefined ? "MTOM —" : `MTOM ${balloon.applicableMtowKg.toLocaleString("fr-FR")} kg`}</b><small>{balloon.configurationLimitsConfirmed ? "Confirmées" : "À confirmer"}</small></span><ChevronRight size={16} /></Link>
      <BalloonDocumentsCard balloonId={balloon.id} />
    </section>

    <Link className={styles.balloonModifyAction} href={editHref}><Pencil size={17} /> Modifier le ballon</Link>
  </div></main>;
}
