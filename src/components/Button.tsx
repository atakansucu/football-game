"use client";

import { clsx } from "@/lib/clsx";

type Variant = "primary" | "ghost";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        variant === "primary" ? "btn-primary" : "btn-ghost",
        "w-full",
        className,
      )}
      {...props}
    />
  );
}
