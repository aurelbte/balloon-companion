import NavigationBar from "../components/NavigationBar";
import JournalFlightList from "../components/journal/JournalFlightList";
import { JOURNAL_FLIGHTS } from "../lib/journalMockData";
import styles from "./Journal.module.css";

export default function JournalPage() {
  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <header>
          <p className={styles.eyebrow}>Journal</p>
          <h1 className={styles.title}>Mes vols</h1>
          <p className={styles.subtitle}>Traces et données enregistrées</p>
        </header>

        <JournalFlightList flights={JOURNAL_FLIGHTS} />
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}
