import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.atakansucu.footballduel",
  appName: "3-2-1 Football",
  // Next.js static export output; bundled into the native shell.
  webDir: "out",
  // Dark base color so no black bars show through before/around the web content.
  backgroundColor: "#04140b",
  ios: {
    // Let the web content run edge-to-edge (under the home indicator); safe-area
    // CSS padding handles the insets. "always" left an unpainted black strip at
    // the bottom on devices with a home indicator.
    contentInset: "never",
    backgroundColor: "#04140b",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#04140b",
      showSpinner: false,
    },
  },
};

export default config;
