import { clsx } from "@/lib/clsx";
import { countryFlag, getClubBadgeVisual } from "@/lib/teamBadge";

interface TeamBadgeProps {
  name: string;
  /** National team -> flag emoji; otherwise a generated non-official badge. */
  national?: boolean;
  /** Square size in px (also drives the emoji/text size). */
  size?: number;
  className?: string;
}

/**
 * A licensing-safe team marker: country emoji for national teams and a fully
 * generated, deterministic shield for clubs. It never loads remote artwork.
 */
export function TeamBadge({
  name,
  national = false,
  size = 56,
  className,
}: TeamBadgeProps) {
  if (national) {
    const flag = countryFlag(name);
    return (
      <span
        className={clsx("inline-flex items-center justify-center", className)}
        style={{ fontSize: Math.round(size * 0.82), lineHeight: 1 }}
        aria-hidden
      >
        {flag ?? "🌐"}
      </span>
    );
  }

  const badge = getClubBadgeVisual(name);
  const shield = "polygon(50% 0%, 91% 14%, 85% 70%, 50% 100%, 15% 70%, 9% 14%)";

  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{
        width: size,
        height: size,
        filter: `drop-shadow(0 ${Math.max(1, Math.round(size * 0.06))}px ${Math.max(1, Math.round(size * 0.1))}px rgb(0 0 0 / 0.28))`,
      }}
      aria-hidden
    >
      <span
        className="absolute inset-0"
        style={{
          clipPath: shield,
          background: "rgb(255 255 255 / 0.22)",
        }}
      />
      <span
        className="absolute flex items-center justify-center font-black tracking-tight"
        style={{
          inset: Math.max(1, Math.round(size * 0.055)),
          clipPath: shield,
          color: badge.foreground,
          background: `linear-gradient(145deg, ${badge.secondary} 0 42%, ${badge.primary} 43% 100%)`,
          boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.2)",
          fontSize: Math.max(7, Math.round(size * 0.27)),
          lineHeight: 1,
          paddingBottom: Math.round(size * 0.04),
          textShadow: "0 1px 2px rgb(0 0 0 / 0.35)",
        }}
      >
        {badge.label}
      </span>
    </span>
  );
}
