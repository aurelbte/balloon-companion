import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import NavigationBar from "../../components/NavigationBar";
import styles from "../More.module.css";
export default function SettingsPage() { return <main className={styles.screen}><div className={styles.layout}><Link href="/more" className={styles.back}><ChevronLeft size={18} /> Plus</Link><header><p className={styles.eyebrow}>Plus</p><h1 className={styles.title}>Réglages</h1><p className={styles.subtitle}>Aucun réglage supplémentaire n’est disponible pour le moment.</p></header></div><NavigationBar activeItem="Plus" /></main>; }
