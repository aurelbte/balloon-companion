"use client";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import BalloonForm from "../../../../components/balloons/BalloonForm";
import { addBalloon, NEW_BALLOON_RETURN_KEY, NEW_BALLOON_SELECTION_KEY } from "../../../../lib/balloonStorage";
import styles from "../../../More.module.css";
export default function NewBalloonPage() { const router = useRouter(); const destination = () => window.sessionStorage.getItem(NEW_BALLOON_RETURN_KEY) || "/more/profile/balloons"; const finish = (selectedId?: string) => { const target = destination(); window.sessionStorage.removeItem(NEW_BALLOON_RETURN_KEY); if (selectedId) window.sessionStorage.setItem(NEW_BALLOON_SELECTION_KEY, selectedId); router.push(target); }; return <main className={styles.screen}><div className={styles.layout}><button type="button" className={styles.back} onClick={() => finish()}><ChevronLeft size={18} aria-hidden="true" /> Mes ballons</button><header><p className={styles.eyebrow}>Profil pilote</p><h1 className={styles.title}>Ajouter un ballon</h1><p className={styles.subtitle}>Les informations enregistrées seront réutilisées dans toute l’application.</p></header><BalloonForm submitLabel="Enregistrer le ballon" onCancel={() => finish()} onSubmit={(input) => { const balloon = addBalloon(input); finish(balloon.id); }} /></div></main>; }
