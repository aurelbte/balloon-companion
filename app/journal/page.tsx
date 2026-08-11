import NavigationBar from "../components/NavigationBar";
import JournalHub from "../components/journal/JournalHub";
import styles from "./Journal.module.css";

export default function JournalPage() {
  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <header>
          <p className={styles.eyebrow}>Journal</p>
          <h1 className={styles.title}>Journal</h1>
          <p className={styles.subtitle}>Vols enregistrés et carnet d’ascensions</p>
        </header>

        <JournalHub />
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}
