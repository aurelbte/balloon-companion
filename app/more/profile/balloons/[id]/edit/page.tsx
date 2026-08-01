"use client";
import { ChevronLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import BalloonForm from "../../../../../components/balloons/BalloonForm";
import { useBalloonRegistry } from "../../../../../hooks/useBalloons";
import { editBalloon } from "../../../../../lib/balloonStorage";
import styles from "../../../../More.module.css";
export default function EditBalloonPage() { const { id } = useParams<{ id: string }>(); const router = useRouter(); const registry = useBalloonRegistry(); const balloon = registry.balloons.find((item) => item.id === decodeURIComponent(id)); const back = () => router.push(`/more/profile/balloons/${encodeURIComponent(id)}`); if (!balloon) return null; return <main className={styles.screen}><div className={styles.layout}><button type="button" className={styles.back} onClick={back}><ChevronLeft size={18} /> Fiche ballon</button><header><p className={styles.eyebrow}>{balloon.registration}</p><h1 className={styles.title}>Modifier le ballon</h1></header><BalloonForm balloon={balloon} submitLabel="Enregistrer les modifications" onCancel={back} onSubmit={(input) => { editBalloon(balloon.id, input); back(); }} /></div></main>; }
