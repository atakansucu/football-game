import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.atakansucu.footballduel",
  appName: "Football Duel",
  // Next.js static export output; bundled into the native shell.
  webDir: "out",
  ios: {
    contentInset: "always",
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
