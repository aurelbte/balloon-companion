import Image from "next/image";
import { ClipboardCheck } from "lucide-react";
import { Button } from "./design-system";
import NavigationBar from "./components/NavigationBar";
import ConditionsCard from "./components/cockpit/ConditionsCard";
import HeroRing from "./components/cockpit/HeroRing";
import LastFlightCard from "./components/cockpit/LastFlightCard";
import { MOCK_COCKPIT_DATA } from "./components/cockpit/mockCockpitData";
import MyBalloonsCard from "./components/cockpit/MyBalloonsCard";
import PilotStatusCard from "./components/cockpit/PilotStatusCard";
import appIcon from "./icon.png";
import styles from "./components/cockpit/Cockpit.module.css";

export default function CockpitPage() {
  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              className={styles.logo}
              src={appIcon}
              alt=""
              priority
              sizes="24px"
            />
            <span>Balloon Companion</span>
          </div>
          <h1 className={styles.welcome}>Bonjour Aurélien 👋</h1>
        </header>

        <HeroRing data={MOCK_COCKPIT_DATA.hero} />

        <div className={styles.pair}>
          <PilotStatusCard data={MOCK_COCKPIT_DATA.pilotStatus} />
          <ConditionsCard data={MOCK_COCKPIT_DATA.conditions} />
        </div>

        <Button
          className={styles.cta}
          href="/prepare"
          fullWidth
          aria-label="Préparer mon vol"
        >
          <ClipboardCheck size={19} aria-hidden="true" />
          Préparer mon vol
        </Button>

        <div className={styles.pair}>
          <LastFlightCard
            data={MOCK_COCKPIT_DATA.lastFlight}
            href="/journal/lfqo-merignies"
          />
          <MyBalloonsCard
            balloons={MOCK_COCKPIT_DATA.balloons}
            href="/prepare"
          />
        </div>
      </div>

      <NavigationBar activeItem="Cockpit" />
    </main>
  );
}
