"use client";
import { Camera, ChevronLeft, FileUp } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { balloonDocumentStorage } from "../../../../../../lib/balloonDocumentStorage";
import { BALLOON_DOCUMENT_ACCEPT, BALLOON_DOCUMENT_CATEGORIES, BALLOON_DOCUMENT_PRIMARY_CARDS, documentTitleFromFileName, validateBalloonDocumentFile, type BalloonDocumentCategory } from "../../../../../../lib/balloonDocuments";
import styles from "../../../../../More.module.css";

function isCategory(value: string | null): value is BalloonDocumentCategory { return BALLOON_DOCUMENT_CATEGORIES.some(([category]) => category === value); }

function AddBalloonDocumentContent() {
  const { id } = useParams<{ id: string }>(); const balloonId = decodeURIComponent(id); const router = useRouter();
  const searchParams = useSearchParams(); const requestedCategory = searchParams.get("category"); const quickCategory = isCategory(requestedCategory) ? requestedCategory : null; const initialCategory = quickCategory ?? "REGISTRATION_CERTIFICATE"; const suggestedTitle = BALLOON_DOCUMENT_PRIMARY_CARDS.find(({ addCategory }) => addCategory === initialCategory)?.suggestedTitle ?? "";
  const [category, setCategory] = useState<BalloonDocumentCategory>(initialCategory); const [file, setFile] = useState<File | null>(null); const [title, setTitle] = useState(suggestedTitle); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const chooseFile = (selected: File | undefined) => { if (!selected) return; const issue = validateBalloonDocumentFile(selected); if (issue) { setError(issue); return; } setFile(selected); setError(null); if (!title.trim()) setTitle(documentTitleFromFileName(selected.name)); };
  const save = async () => { if (!file || !title.trim()) return; setSaving(true); setError(null); try { await balloonDocumentStorage.addDocument({ balloonId, category, title }, file); router.push(`/more/profile/balloons/${encodeURIComponent(balloonId)}/documents`); } catch (reason) { setError(reason instanceof Error ? reason.message : "Le fichier n’a pas pu être enregistré."); setSaving(false); } };
  return <main className={styles.screen}><div className={styles.layout}><Link href={`/more/profile/balloons/${encodeURIComponent(balloonId)}/documents`} className={styles.back}><ChevronLeft size={18} /> Documents</Link><header><p className={styles.eyebrow}>Porte-documents</p><h1 className={styles.title}>Ajouter un document</h1></header>
    <form className={styles.documentForm} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {quickCategory ? <p className={styles.documentPresetCategory}>{BALLOON_DOCUMENT_CATEGORIES.find(([value]) => value === category)?.[1]}</p> : <label><span>Catégorie</span><select value={category} onChange={(event) => setCategory(event.target.value as BalloonDocumentCategory)}>{BALLOON_DOCUMENT_CATEGORIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
      <div className={styles.documentFileActions}><label><FileUp size={18} /> Choisir un fichier<input type="file" accept={BALLOON_DOCUMENT_ACCEPT} onChange={(event) => chooseFile(event.target.files?.[0])} /></label><label><Camera size={18} /> Prendre une photo<input type="file" accept="image/*" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0])} /></label></div>
      {file && <p className={styles.documentSelectedFile}>{file.name}</p>}
      <label><span>Titre</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titre du document" /></label>
      {error && <p className={styles.error}>{error}</p>}
      <button type="submit" className={styles.documentSave} disabled={!file || !title.trim() || saving}>{saving ? "Enregistrement…" : "Enregistrer hors ligne"}</button>
    </form>
  </div></main>;
}

export default function AddBalloonDocumentPage() {
  return <Suspense fallback={<main className={styles.screen}><div className={styles.layout}><p className={styles.subtitle}>Préparation de l’ajout…</p></div></main>}><AddBalloonDocumentContent /></Suspense>;
}
