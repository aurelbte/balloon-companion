"use client";

import { BookOpen, ChevronLeft, ChevronRight, ClipboardCheck, FileBadge, FileText, FolderOpen, Plus, Radio, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ComponentType } from "react";
import { useBalloonRegistryState } from "../../../../../hooks/useBalloons";
import { BALLOON_DOCUMENTS_CHANGED_EVENT, balloonDocumentStorage } from "../../../../../lib/balloonDocumentStorage";
import { BALLOON_DOCUMENT_PRIMARY_CARDS, balloonDocumentCardHref, balloonDocumentPrimaryCardById, documentsForPrimaryCard, type BalloonDocument, type BalloonDocumentPrimaryCard } from "../../../../../lib/balloonDocuments";
import styles from "../../../../More.module.css";

const CARD_ICONS: Readonly<Record<BalloonDocumentPrimaryCard["icon"], ComponentType<{ size?: number }>>> = {
  registration: FileBadge,
  airworthiness: ClipboardCheck,
  insurance: ShieldCheck,
  radio: Radio,
  manual: BookOpen,
  weighing: Scale,
  inspections: ClipboardCheck,
  other: FolderOpen,
};

function DocumentsContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const balloonId = decodeURIComponent(id);
  const { registry, hydrated } = useBalloonRegistryState();
  const balloon = registry.balloons.find((item) => item.id === balloonId);
  const selectedGroup = balloonDocumentPrimaryCardById(searchParams.get("group"));
  const [documents, setDocuments] = useState<readonly BalloonDocument[]>([]);
  const [missingFileIds, setMissingFileIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      setLoading(true);
      void balloonDocumentStorage.listByBalloonId(balloonId).then(async (items) => {
        const files = await Promise.all(items.map((document) => balloonDocumentStorage.getDocumentFile(document.id)));
        if (!active) return;
        setDocuments(items);
        setMissingFileIds(new Set(items.filter((_, index) => !files[index]).map(({ id: documentId }) => documentId)));
        setError(null);
        setLoading(false);
      }).catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Les documents ne sont pas disponibles.");
        setLoading(false);
      });
    };
    refresh();
    window.addEventListener(BALLOON_DOCUMENTS_CHANGED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(BALLOON_DOCUMENTS_CHANGED_EVENT, refresh); };
  }, [balloonId]);

  const filteredDocuments = selectedGroup ? documentsForPrimaryCard(documents, selectedGroup) : [];

  return <main className={styles.screen}><div className={styles.layout}>
    <Link href={selectedGroup ? `/more/profile/balloons/${encodeURIComponent(balloonId)}/documents` : `/more/profile/balloons/${encodeURIComponent(balloonId)}`} className={styles.back}><ChevronLeft size={18} /> {selectedGroup ? "Documents" : balloon?.registration ?? "Ballon"}</Link>
    <header className={styles.documentHeader}><p className={styles.eyebrow}>Porte-documents</p><h1 className={styles.title}>{selectedGroup?.label ?? "Documents"}</h1>{!selectedGroup && <p className={styles.subtitle}>Les papiers de ce ballon, disponibles hors ligne.</p>}</header>
    {!hydrated ? <p className={styles.subtitle}>Chargement du ballon…</p> : !balloon ? <p className={styles.error}>Ballon introuvable.</p> : <>
      {error && <p className={styles.error}>{error}</p>}
      {selectedGroup ? <><div className={styles.documentList}>{filteredDocuments.map((document) => <Link key={document.id} href={`/more/profile/balloons/${encodeURIComponent(balloonId)}/documents/${encodeURIComponent(document.id)}`} className={styles.documentRow}><FileText size={20} /><span><strong>{document.title}</strong><small>{missingFileIds.has(document.id) ? "Document indisponible" : document.originalFileName}</small></span><ChevronRight size={17} /></Link>)}</div><Link href={`/more/profile/balloons/${encodeURIComponent(balloonId)}/documents/new?category=${selectedGroup.addCategory}`} className={styles.documentSecondaryAction}><Plus size={17} /> Ajouter dans {selectedGroup.label.toLocaleLowerCase("fr-FR")}</Link></> : <>
        <div className={styles.documentGrid} aria-label="Documents principaux">{BALLOON_DOCUMENT_PRIMARY_CARDS.map((card) => {
          const matching = documentsForPrimaryCard(documents, card);
          const Icon = CARD_ICONS[card.icon];
          const unavailable = matching.length === 1 && missingFileIds.has(matching[0].id);
          const secondary = loading ? "Chargement…" : matching.length === 0 ? "Ajouter" : unavailable ? "Document indisponible" : matching.length === 1 ? matching[0].title : `${matching.length} documents`;
          return <Link key={card.id} href={balloonDocumentCardHref(balloonId, card, documents)} className={styles.documentGridCard}><Icon size={19} /><span><strong>{card.label}</strong><small>{secondary}</small></span>{matching.length === 0 ? <Plus size={16} /> : <ChevronRight size={16} />}</Link>;
        })}</div>
        <Link href={`/more/profile/balloons/${encodeURIComponent(balloonId)}/documents/new`} className={styles.documentSecondaryAction}><Plus size={17} /> Ajouter un document</Link>
      </>}
    </>}
  </div></main>;
}

export default function BalloonDocumentsPage() {
  return <Suspense fallback={<main className={styles.screen}><div className={styles.layout}><p className={styles.subtitle}>Chargement des documents…</p></div></main>}><DocumentsContent /></Suspense>;
}
