import type { ReactNode } from "react";
import { css, html } from "react-strict-dom";
import { tokens } from "./tokens.css";

const styles = css.create({
  base: {
    alignItems: "center",
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    cursor: "pointer",
    display: "flex",
    fontFamily: tokens.font,
    fontSize: 14,
    fontWeight: 700,
    justifyContent: "center",
    minHeight: 40,
    paddingInline: 14,
  },
  primary: {
    backgroundColor: {
      default: tokens.accent,
      ":hover": tokens.accentHover,
    },
    borderColor: tokens.accent,
    color: "#ffffff",
  },
  quiet: {
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.canvas,
    },
    borderColor: tokens.border,
    color: tokens.ink,
  },
});

type ButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: "primary" | "quiet";
};

export function Button({
  children,
  disabled = false,
  onClick,
  variant = "primary",
}: ButtonProps) {
  return (
    <html.button
      {...(onClick === undefined || disabled
        ? {}
        : { onClick: () => onClick() })}
      disabled={disabled}
      style={[styles.base, variant === "primary" ? styles.primary : styles.quiet]}
      type="button"
    >
      {children}
    </html.button>
  );
}
