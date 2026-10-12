import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Touch-first (Capacitor iOS): only apply `hover:` styles on devices that
  // truly support hover, so a tap doesn't leave cards stuck in a hover state.
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        pitch: {
          950: "#04140b",
          900: "#062012",
          800: "#0a2c19",
        },
        accent: {
          DEFAULT: "#22c55e",
          soft: "#4ade80",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
