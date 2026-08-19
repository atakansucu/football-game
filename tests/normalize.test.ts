import { describe, expect, it } from "vitest";
import { normalizePlayerName } from "@/lib/football/normalize";

describe("normalizePlayerName", () => {
  it("lowercases and trims", () => {
    expect(normalizePlayerName("  Arda GULER ")).toBe("arda guler");
  });

  it("collapses duplicate whitespace", () => {
    expect(normalizePlayerName("arda   guler")).toBe("arda guler");
  });

  it("is accent-insensitive", () => {
    expect(normalizePlayerName("Arda Güler")).toBe("arda guler");
    expect(normalizePlayerName("Cesc Fàbregas")).toBe("cesc fabregas");
    expect(normalizePlayerName("Zlatan Ibrahimović")).toBe(
      "zlatan ibrahimovic",
    );
  });

  it("normalizes apostrophes and hyphens to spaces", () => {
    expect(normalizePlayerName("N'Golo Kanté")).toBe("n golo kante");
    expect(normalizePlayerName("Trent Alexander-Arnold")).toBe(
      "trent alexander arnold",
    );
  });

  it("treats equivalent spellings identically", () => {
    expect(normalizePlayerName("Arda Güler")).toBe(
      normalizePlayerName("arda guler"),
    );
  });
});
