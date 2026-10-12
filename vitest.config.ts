import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Integration tests exercise server modules only. Avoid loading the
  // production Tailwind/PostCSS pipeline while Vitest collects those modules.
  css: {
    postcss: { plugins: [] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
