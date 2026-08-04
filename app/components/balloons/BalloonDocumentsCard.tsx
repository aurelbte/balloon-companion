"use client";
import { ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BALLOON_DOCUMENTS_CHANGED_EVENT, balloonDocumentStorage } from "../../lib/balloonDocumentStorage";
import styles from "../../more/More.module.css";

export default function BalloonDocumentsCard({ balloonId }: { balloonId: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { let active = true; const refresh = () => { void balloonDocumentStorage.countByBalloonId(balloonId).then((value) => { if (active) setCount(value); }).catch(() => { if (active) setCount(null); }); }; refresh(); window.addEventListener(BALLOON_DOCUMENTS_CHANGED_EVENT, refresh); return () => { active = false; window.removeEventListener(BALLOON_DOCUMENTS_CHANGED_EVENT, refresh); }; }, [balloonId]);
  return <Link href={`/more/profile/balloons/${encodeURIComponent(balloonId)}/documents`} className={styles.balloonSummaryCard}>
    <FileText size={18} aria-hidden />
    <span><strong>Documents</strong><b>{count === null ? "Chargement…" : count === 0 ? "0 document" : `${count} document${count > 1 ? "s" : ""}`}</b><small>{count === 0 ? "Ajouter" : "Voir"} →</small></span>
    <ChevronRight size={16} aria-hidden />
  </Link>;
}
