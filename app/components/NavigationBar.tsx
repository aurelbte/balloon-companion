import Link from "next/link";

const navigationItems = [
  { label: "Accueil", href: "/" },
  { label: "Préparer", href: "/prepare" },
  { label: "Vol", href: "/flight" },
  { label: "Carnet", href: "/carnet" },
  { label: "Profil", href: "/profil" },
];

type NavigationBarProps = {
  activeItem?: string;
};

export default function NavigationBar({ activeItem = "Accueil" }: NavigationBarProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 border-t px-4 pb-4 pt-3 backdrop-blur-xl"
      style={{
        background: "rgb(7 17 31 / 92%)",
        borderColor: "var(--bc-border)",
      }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
        {navigationItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex min-h-12 flex-col items-center justify-center gap-1 text-xs font-semibold"
            style={{
              color:
                activeItem === item.label
                  ? "var(--bc-accent)"
                  : "var(--bc-text-muted)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  activeItem === item.label
                    ? "var(--bc-accent)"
                    : "transparent",
              }}
            />

            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}