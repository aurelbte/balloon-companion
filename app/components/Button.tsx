import { Button as DesignSystemButton } from "../design-system";

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
};

/**
 * Compatibility entry point for existing screens.
 * New code should import Button directly from `app/design-system`.
 */
export default function Button({ children, onClick, href }: ButtonProps) {
  return (
    <DesignSystemButton href={href} onClick={onClick} fullWidth>
      {children}
    </DesignSystemButton>
  );
}
