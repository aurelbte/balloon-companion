"use client";

import Link from "next/link";
import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

function joinClassNames(
  ...classNames: Array<string | false | null | undefined>
) {
  return classNames.filter(Boolean).join(" ");
}

type ButtonProps = {
  children: ReactNode;
  className?: string;
  href?: string;
  fullWidth?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
} & ButtonHTMLAttributes<HTMLButtonElement>;

/** Premium action with complete interaction, disabled, and loading states. */
export function Button({
  children,
  className,
  href,
  fullWidth = false,
  loading = false,
  loadingLabel = "Chargement…",
  variant = "primary",
  ...buttonProps
}: ButtonProps) {
  const classes = joinClassNames(
    "bc-button",
    variant !== "primary" && `bc-button--${variant}`,
    fullWidth && "bc-button--full",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        <span className="bc-button__content">{children}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      data-loading={loading}
      aria-busy={loading}
      {...buttonProps}
      disabled={loading || buttonProps.disabled}
    >
      <span className="bc-button__content">{children}</span>
      {loading && (
        <>
          <span className="bc-button__spinner" aria-hidden="true" />
          <span className="sr-only">{loadingLabel}</span>
        </>
      )}
    </button>
  );
}

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
};

/** Compact selection control for filters and map choices. */
export function Chip({
  className,
  selected = false,
  type = "button",
  ...props
}: ChipProps) {
  return (
    <button
      type={type}
      className={joinClassNames("bc-chip", className)}
      data-selected={selected}
      aria-pressed={selected}
      {...props}
    />
  );
}

/** Floating content container for map overlays and contextual tools. */
export function Panel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <section className={joinClassNames("bc-panel", className)} {...props} />;
}

type FloatingPanelProps = HTMLAttributes<HTMLDivElement> & {
  surface?: "glass" | "floating" | "overlay";
};

/** Premium translucent map surface for contextual, non-blocking content. */
export const FloatingPanel = forwardRef<HTMLElement, FloatingPanelProps>(
  function FloatingPanel(
    { className, surface = "floating", ...props },
    ref,
  ) {
    return (
      <aside
        ref={ref}
        className={joinClassNames(
          "bc-floating-panel",
          `bc-surface--${surface}`,
          className,
        )}
        {...props}
      />
    );
  },
);

/** Standard information container for non-map screens. */
export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <article className={joinClassNames("bc-card", className)} {...props} />;
}

/** Safe-area-aware floating dock used for primary bottom controls. */
export function BottomDock({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={joinClassNames("bc-bottom-dock", className)} {...props} />
  );
}

export type SegmentedControlOption<Value extends string> = {
  label: string;
  value: Value;
  disabled?: boolean;
};

type SegmentedControlProps<Value extends string> = {
  "aria-label": string;
  className?: string;
  onChange: (value: Value) => void;
  options: readonly SegmentedControlOption<Value>[];
  value: Value;
};

/** Mutually exclusive choices sharing one compact visual container. */
export function SegmentedControl<Value extends string>({
  className,
  onChange,
  options,
  value,
  ...ariaProps
}: SegmentedControlProps<Value>) {
  return (
    <div
      className={joinClassNames("bc-segmented-control", className)}
      role="group"
      {...ariaProps}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="bc-segmented-control__option"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type FloatingActionProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** One-hand map action with a consistent 48 px touch target. */
export function FloatingAction({
  className,
  type = "button",
  ...props
}: FloatingActionProps) {
  return (
    <button
      type={type}
      className={joinClassNames("bc-floating-action", className)}
      {...props}
    />
  );
}
