import Link from "next/link";
import {
  BookOpen,
  CircleGauge,
  ClipboardCheck,
  MoreHorizontal,
  Navigation,
} from "lucide-react";
import { MAIN_NAVIGATION_ITEMS } from "../lib/flightNavigation";

type NavigationBarProps = {
  activeItem?: string;
  onNavigate?: (href: string) => void;
};

export default function NavigationBar({
  activeItem = "Cockpit",
  onNavigate,
}: NavigationBarProps) {
  const icons = {
    cockpit: CircleGauge,
    prepare: ClipboardCheck,
    flight: Navigation,
    journal: BookOpen,
    more: MoreHorizontal,
  } as const;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 border-t px-4 pt-3 backdrop-blur-xl"
      style={{
        background: "var(--bc-color-surface-glass)",
        borderColor: "var(--bc-color-border)",
        paddingBottom:
          "max(var(--bc-space-4), env(safe-area-inset-bottom))",
        zIndex: "var(--bc-z-navigation)",
      }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
        {MAIN_NAVIGATION_ITEMS.map((item) => {
          const Icon = icons[item.icon];
          const isDisabled = "disabled" in item && item.disabled;
          const content = (
            <>
              <Icon size={18} strokeWidth={activeItem === item.label ? 2.4 : 2} />
              <span>{item.label}</span>
            </>
          );
          const sharedProps = {
            className:
              "flex min-h-12 flex-col items-center justify-center gap-1 text-[0.65rem] font-semibold",
            style: {
              border: "none",
              background: "transparent",
              color:
                activeItem === item.label
                  ? "var(--bc-color-action)"
                  : "var(--bc-color-text-muted)",
              opacity: isDisabled ? 0.55 : 1,
            },
          };
          if (isDisabled) {
            return (
              <button
                key={item.label}
                type="button"
                disabled
                aria-label={`${item.label}, bientôt disponible`}
                {...sharedProps}
              >
                {content}
              </button>
            );
          }
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
