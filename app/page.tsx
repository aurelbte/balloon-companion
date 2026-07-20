import Button from "./components/Button";
import NavigationBar from "./components/NavigationBar";
import TopStatusBar from "./components/TopStatusBar";

const systemStatus = [
  { label: "GPS", status: "Prêt", color: "var(--bc-success)" },
  { label: "Météo", status: "À actualiser", color: "var(--bc-warning)" },
  { label: "Réseau", status: "Connecté", color: "var(--bc-success)" },
  { label: "Cartes", status: "Disponible", color: "var(--bc-success)" },
];

const flightData = [
  { label: "Vent au sol", value: "6 km/h", detail: "240°" },
  { label: "Vent à 300 m", value: "14 km/h", detail: "255°" },
  { label: "Lever du soleil", value: "05:58", detail: "Heure locale" },
  { label: "Espaces aériens", value: "À vérifier", detail: "Avant le vol" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen px-4 pb-28 pt-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <TopStatusBar />

        <header className="mb-7">
          <p
            className="mb-2 text-sm font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--bc-accent)" }}
          >
            Balloon Companion
          </p>

          <h1 className="text-3xl font-bold tracking-tight">
            Bonjour Aurélien
          </h1>

          <p
            className="mt-2 text-base"
            style={{ color: "var(--bc-text-secondary)" }}
          >
            Préparons ton prochain vol.
          </p>
        </header>

        <section
          className="mb-5 overflow-hidden border"
          style={{
            background: "var(--bc-background-elevated)",
            borderColor: "var(--bc-border)",
            borderRadius: "var(--bc-radius-large)",
            boxShadow: "var(--bc-shadow-card)",
          }}
        >
          <div
            className="flex items-center justify-between border-b px-5 py-4"
            style={{ borderColor: "var(--bc-border)" }}
          >
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-[0.16em]"
                style={{ color: "var(--bc-text-muted)" }}
              >
                Conditions du jour
              </p>

              <h2 className="mt-1 text-xl font-bold">Briefing non lancé</h2>
            </div>

            <div
              className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold"
              style={{
                background: "rgb(240 168 75 / 12%)",
                color: "var(--bc-warning)",
              }}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: "var(--bc-warning)" }}
              />
              À vérifier
            </div>
          </div>

          <div className="grid grid-cols-2">
            {flightData.map((item, index) => (
              <div
                key={item.label}
                className="min-h-28 px-5 py-4"
                style={{
                  borderRight:
                    index % 2 === 0
                      ? "1px solid var(--bc-border)"
                      : undefined,
                  borderBottom:
                    index < 2
                      ? "1px solid var(--bc-border)"
                      : undefined,
                }}
              >
                <p
                  className="text-sm"
                  style={{ color: "var(--bc-text-secondary)" }}
                >
                  {item.label}
                </p>

                <p className="mt-2 text-xl font-bold">{item.value}</p>

                <p
                  className="mt-1 text-xs"
                  style={{ color: "var(--bc-text-muted)" }}
                >
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="mb-7">
          <Button href="/prepare">Préparer un vol</Button>
        </div>

        <section className="mb-7">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-[0.16em]"
                style={{ color: "var(--bc-text-muted)" }}
              >
                Système
              </p>

              <h2 className="mt-1 text-xl font-bold">État de l’application</h2>
            </div>

            <p
              className="text-sm"
              style={{ color: "var(--bc-text-secondary)" }}
            >
              3/4 prêts
            </p>
          </div>

          <div
            className="grid grid-cols-2 gap-px overflow-hidden border"
            style={{
              background: "var(--bc-border)",
              borderColor: "var(--bc-border)",
              borderRadius: "var(--bc-radius-medium)",
            }}
          >
            {systemStatus.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-3 px-4 py-4"
                style={{ background: "var(--bc-surface)" }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    background: item.color,
                    boxShadow: `0 0 12px ${item.color}`,
                  }}
                />

                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--bc-text-secondary)" }}
                  >
                    {item.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <button
            className="min-h-32 border p-4 text-left transition-transform active:scale-[0.98]"
            style={{
              background: "var(--bc-surface)",
              borderColor: "var(--bc-border)",
              borderRadius: "var(--bc-radius-medium)",
            }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--bc-text-muted)" }}
            >
              Carnet
            </span>

            <strong className="mt-5 block text-2xl">0 vol</strong>

            <span
              className="mt-1 block text-sm"
              style={{ color: "var(--bc-text-secondary)" }}
            >
              Consulter le carnet
            </span>
          </button>

          <button
            className="min-h-32 border p-4 text-left transition-transform active:scale-[0.98]"
            style={{
              background: "var(--bc-surface)",
              borderColor: "var(--bc-border)",
              borderRadius: "var(--bc-radius-medium)",
            }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--bc-text-muted)" }}
            >
              Dernier terrain
            </span>

            <strong className="mt-5 block text-2xl">Non défini</strong>

            <span
              className="mt-1 block text-sm"
              style={{ color: "var(--bc-text-secondary)" }}
            >
              Ajouter un terrain
            </span>
          </button>
        </section>
      </div>

      <NavigationBar activeItem="Accueil" />
    </main>
  );
}
