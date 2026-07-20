import {
  BatteryFull,
  CloudSun,
  Map,
  Satellite,
  Signal,
} from "lucide-react";

type StatusItem = {
  icon: React.ReactNode;
  title: string;
  value: string;
};

export default function TopStatusBar() {
  const statuses: StatusItem[] = [
    {
      icon: <Satellite size={18} />,
      title: "GPS",
      value: "Prêt",
    },
    {
      icon: <Signal size={18} />,
      title: "Réseau",
      value: "4G",
    },
    {
      icon: <CloudSun size={18} />,
      title: "Météo",
      value: "Clair",
    },
    {
      icon: <Map size={18} />,
      title: "Cartes",
      value: "OK",
    },
    {
      icon: <BatteryFull size={18} />,
      title: "Batterie",
      value: "100%",
    },
  ];

  return (
    <div
      className="mb-5 overflow-hidden rounded-lg border p-3"
      style={{
        background: "var(--bc-surface)",
        borderColor: "var(--bc-border)",
      }}
    >
      <div className="grid grid-cols-5 gap-2">
        {statuses.map((item, index) => (
          <Status key={index} {...item} />
        ))}
      </div>
    </div>
  );
}

type StatusProps = {
  icon: React.ReactNode;
  title: string;
  value: string;
};

function Status({ icon, title, value }: StatusProps) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {/* Icon */}
      <div
        style={{ color: "var(--bc-success)" }}
      >
        {icon}
      </div>

      {/* Title */}
      <div
        className="text-xs font-semibold uppercase tracking-tight"
        style={{ color: "var(--bc-text-primary)" }}
      >
        {title}
      </div>

      {/* Value */}
      <div
        className="text-[10px]"
        style={{ color: "var(--bc-text-muted)" }}
      >
        {value}
      </div>
    </div>
  );
}