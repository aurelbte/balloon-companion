import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import NavigationBar from "../../components/NavigationBar";
import styles from "../More.module.css";
export default function SettingsPage() { return <main className={styles.screen}><div className={styles.layout}><Link href="/more" className={styles.back}><ChevronLeft size={18} /> Plus</Link><header><p className={styles.eyebrow}>Réglages de l’app</p><h1 className={styles.title}>Réglages</h1></header><Link href="/more/settings/units" className={styles.card}><div><h2>Unités</h2><p>Météo et instruments de vol</p></div><ChevronRight size={18} aria-hidden="true" /></Link></div><NavigationBar activeItem="Plus" /></main>; }
