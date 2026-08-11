"use client";

import { useEffect } from "react";
import { useBalloonAuth } from "../../contexts/AuthContext";
import styles from "./LocalDataMigrationDialog.module.css";

export default function LocalDataMigrationDialog() {
  const auth = useBalloonAuth();
  const migration = auth.pendingLocalDataMigration;
  const visible = auth.state === "SIGNED_IN" && migration?.state === "PENDING_LOCAL_DATA_MIGRATION";

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [visible]);

  if (!visible) return null;
  const summary = migration.legacyDataSummary;

  return (
    <div className={styles.backdrop}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="local-data-title">
        <div className={styles.handle} aria-hidden="true" />
        <h2 id="local-data-title">Données trouvées sur cet appareil</h2>
        <p>Balloon Companion a trouvé des données déjà présentes sur cet appareil. Souhaitez-vous les rattacher à votre compte&nbsp;?</p>
        <ul className={styles.summary}>
          <li><strong>{summary.flights}</strong> vol{summary.flights > 1 ? "s" : ""}</li>
          <li><strong>{summary.journalEntries}</strong> entrée{summary.journalEntries > 1 ? "s" : ""} carnet</li>
          <li><strong>{summary.balloons}</strong> ballon{summary.balloons > 1 ? "s" : ""}</li>
          <li><strong>{summary.documents}</strong> document{summary.documents > 1 ? "s" : ""}</li>
          {summary.otherBusinessStorages > 0 && <li>Autres données disponibles</li>}
        </ul>
        <div className={styles.actions}>
          <button type="button" autoFocus onClick={() => auth.decideLocalDataMigration("MIGRATION_APPROVED")}>Rattacher à mon compte</button>
          <button type="button" onClick={() => auth.decideLocalDataMigration("MIGRATION_DEFERRED")}>Continuer sans les rattacher</button>
          <button type="button" onClick={() => auth.decideLocalDataMigration("MIGRATION_DEFERRED")}>Plus tard</button>
        </div>
      </section>
    </div>
  );
}
