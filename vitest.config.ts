import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Unit/integration tests do not render CSS. Keeping an empty inline PostCSS
  // config prevents Vite from loading the production Tailwind pipeline while
  // database tests are being collected.
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
