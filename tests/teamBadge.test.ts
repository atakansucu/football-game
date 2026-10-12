import { describe, expect, it } from "vitest";
import {
  clubInitials,
  countryFlag,
  getClubBadgeVisual,
} from "@/lib/teamBadge";

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function whiteContrast(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

describe("generated team badges", () => {
  it.each([
    ["Barcelona", "BAR"],
    ["Bayern Munich", "BAY"],
    ["Galatasaray", "GAL"],
    ["Paris Saint Germain", "PSG"],
    ["FC Porto", "POR"],
  ])("creates a short label for %s", (name, expected) => {
    expect(clubInitials(name)).toBe(expected);
  });

  it("returns stable, self-contained club colors", () => {
    const first = getClubBadgeVisual("Galatasaray");
    const second = getClubBadgeVisual("Galatasaray");

    expect(second).toEqual(first);
    expect(first.primary).toMatch(/^#[0-9A-F]{6}$/);
    expect(first.secondary).toMatch(/^#[0-9A-F]{6}$/);
    expect(first.primary).not.toBe(first.secondary);
    expect(first.foreground).toBe("#FFFFFF");
  });

  it("keeps every generated background readable with white badge text", () => {
    const colors = new Set<string>();
    for (let index = 0; index < 500; index++) {
      let value = index;
      let suffix = "";
      do {
        suffix = String.fromCharCode(97 + (value % 26)) + suffix;
        value = Math.floor(value / 26) - 1;
      } while (value >= 0);

      const badge = getClubBadgeVisual(`Contrast Test ${suffix}`);
      colors.add(badge.primary);
      colors.add(badge.secondary);
    }

    expect(colors.size).toBe(20);
    for (const color of colors) expect(whiteContrast(color)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps national teams represented by emoji flags", () => {
    expect(countryFlag("Türkiye")).toBe("🇹🇷");
    expect(countryFlag("England")).toBe("🏴󠁧󠁢󠁥󠁮󠁧󠁿");
    expect(countryFlag("Unknown Team")).toBeNull();
  });
});
