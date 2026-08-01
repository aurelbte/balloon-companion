import { ChevronRight } from "lucide-react";
import Link from "next/link";
import NavigationBar from "../components/NavigationBar";
import styles from "./More.module.css";

export default function MorePage() {
  return <main className={styles.screen}><div className={styles.layout}>
    <header><p className={styles.eyebrow}>Balloon Companion</p><h1 className={styles.title}>Plus</h1></header>
    <Link href="/more/profile" className={styles.card}><div><h2>Profil pilote</h2><p>Expérience et informations du pilote</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <Link href="/more/profile/balloons" className={styles.card}><div><h2>Mes ballons</h2><p>Matériel utilisé dans Balloon Companion</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
    <Link href="/more/settings" className={styles.card}><div><h2>Réglages</h2><p>Comportement de l’application</p></div><ChevronRight size={18} aria-hidden="true" /></Link>
  </div><NavigationBar activeItem="Plus" /></main>;
}
