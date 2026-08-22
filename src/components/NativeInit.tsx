"use client";

import { useEffect } from "react";

/**
 * Runs Capacitor native setup once on the client. No-ops on the web build
 * (plugins are dynamically imported and guarded by isNativePlatform), so the
 * static export keeps working in a normal browser.
 */
export function NativeInit() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const [{ StatusBar, Style }, { SplashScreen }, { Keyboard, KeyboardResize }] =
        await Promise.all([
          import("@capacitor/status-bar"),
          import("@capacitor/splash-screen"),
          import("@capacitor/keyboard"),
        ]);

      // Dark background -> light status bar content.
      try {
        await StatusBar.setStyle({ style: Style.Light });
      } catch {}

      // Resize the webview when the keyboard shows so inputs stay visible.
      try {
        await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
      } catch {}

      if (!cancelled) {
        try {
          await SplashScreen.hide();
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
