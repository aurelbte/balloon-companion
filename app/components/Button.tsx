"use client";
import Link from "next/link";

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
};

export default function Button({
  children,
  onClick,
  href,
}: ButtonProps) {
  const buttonStyle = {
    width: "100%",
    padding: "18px",
    borderRadius: "16px",
    border: "none",
    background: "var(--bc-accent)",
    color: "var(--bc-accent-foreground)",
    fontWeight: 700,
    fontSize: "18px",
    boxShadow: "var(--bc-shadow-action)",
    transition: "0.2s",
  };

  if (href) {
    return (
      <Link href={href} style={{ display: "block" }}>
        <button
          style={buttonStyle}
        >
          {children}
        </button>
      </Link>
    );
  }

  return (
    <button
      onClick={onClick}
      style={buttonStyle}
    >
      {children}
    </button>
  );
}