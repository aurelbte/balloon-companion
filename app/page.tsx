"use client";

import Image from "next/image";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useMemo } from "react";
import { Button } from "./design-system";
import NavigationBar from "./components/NavigationBar";
import ConditionsCard from "./components/cockpit/ConditionsCard";
import CockpitHeroRing from "./components/cockpit/CockpitHeroRing";
import CockpitExperiencePrompt from "./components/cockpit/CockpitExperiencePrompt";
import LastFlightCard from "./components/cockpit/LastFlightCard";
import MyBalloonsCard from "./components/cockpit/MyBalloonsCard";
import PilotStatusCard from "./components/cockpit/PilotStatusCard";
import { useBalloonAuth } from "./contexts/AuthContext";
import { useFlightCompletionState } from "./hooks/useFlightCompletionState";
import { usePilotProfile } from "./hooks/usePilotProfile";
import { latestRealJournalFlight } from "./lib/realFlightJournal";
import styles from "./components/cockpit/Cockpit.module.css";

const cockpitLogo = "/branding/balloon-companion-logo-marine-fond-bleu.png";
const welcomeLogo = "/branding/balloon-companion-logo-principal-horizontal.png";

export default function CockpitPage() {
  const auth = useBalloonAuth();
  const completion = useFlightCompletionState();
  const profile = usePilotProfile();
  const choicePending = auth.state === "SIGNED_OUT" && auth.authChoiceState === "AUTH_CHOICE_PENDING";
  const lastFlight = useMemo(() => latestRealJournalFlight(completion.journalFlights), [completion.journalFlights]);
  const firstName = auth.state === "SIGNED_IN" || auth.state === "OFFLINE_SESSION" ? auth.user?.firstName : profile.firstName;

  if (choicePending) {
    return <main className={styles.welcomeScreen}>
      <section className={styles.welcomePanel}>
        <Image className={styles.welcomeLogo} src={welcomeLogo} alt="Balloon Companion — Le copilote numérique des pilotes de montgolfière" width={720} height={335} priority sizes="(max-width: 430px) calc(100vw - 44px), 340px" />
        <h1>Bienvenue</h1>
        <div className={styles.welcomeActions}>
          <Link href="/auth/sign-in">Se connecter</Link>
          <Link href="/auth/sign-up">Créer un compte</Link>
          <button type="button" onClick={auth.activateGuestMode}>Continuer en mode invité</button>
        </div>
      </section>
    </main>;
  }

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <header className={styles.header}><Image className={styles.logo} src={cockpitLogo} alt="Balloon Companion" width={409} height={202} priority sizes="96px" /><h1 className={styles.welcome}>{firstName ? `Bonjour ${firstName} 👋` : "Bonjour 👋"}</h1></header>
        <CockpitHeroRing />
        <CockpitExperiencePrompt />
        <div className={styles.pair}><PilotStatusCard /><ConditionsCard href="/weather" /></div>
        <Button className={styles.cta} href="/prepare" fullWidth aria-label="Préparer mon vol"><ClipboardCheck size={19} aria-hidden="true" />Préparer mon vol</Button>
        <div className={styles.pair}>
          <LastFlightCard data={lastFlight ? { date: lastFlight.date, duration: `${lastFlight.durationMinutes} min`, departure: lastFlight.departure, arrival: lastFlight.arrival } : null} href={lastFlight ? `/journal/${encodeURIComponent(lastFlight.id)}` : "/journal"} />
          <MyBalloonsCard href="/more/profile/balloons" />
        </div>
      </div>
      <NavigationBar activeItem="Cockpit" />
    </main>
  );
}
