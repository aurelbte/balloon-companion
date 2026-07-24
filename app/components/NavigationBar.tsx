import Link from "next/link";
import { MAIN_NAVIGATION_ITEMS } from "../lib/flightNavigation";

type NavigationBarProps = {
  activeItem?: string;
  onNavigate?: (href: string) => void;
};

export default function NavigationBar({
  activeItem = "Accueil",
  onNavigate,
}: NavigationBarProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 border-t px-4 pb-4 pt-3 backdrop-blur-xl"
      style={{
        background: "rgb(7 17 31 / 92%)",
        borderColor: "var(--bc-border)",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        zIndex: 60,
      }}
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {MAIN_NAVIGATION_ITEMS.map((item) => {
          const content = (
            <>
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
            </>
          );
          const sharedProps = {
            className:
              "flex min-h-12 flex-col items-center justify-center gap-1 text-xs font-semibold",
            style: {
              border: "none",
              background: "transparent",
              color:
                activeItem === item.label
                  ? "var(--bc-accent)"
                  : "var(--bc-text-muted)",
            },
          };
          return onNavigate ? (
            <button
              key={item.label}
              type="button"
              onClick={() => onNavigate(item.href)}
              aria-label={`Ouvrir ${item.label}`}
              {...sharedProps}
            >
              {content}
            </button>
          ) : (
            <Link
              key={item.label}
              href={item.href}
              {...sharedProps}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
