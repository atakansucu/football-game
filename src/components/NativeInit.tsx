"use client";

import { useEffect } from "react";
import { initKeyboardViewport } from "@/lib/keyboard";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  fetchClubs,
  fetchNationalTeams,
  getPlayersForClubClub,
  getPlayersForCountryClub,
  prefetchPlayerProfile,
} from "@/features/lookup/api";
import { getSoloChallenge, searchPlayers } from "@/server/game/actions";

/**
 * Runs Capacitor native setup once on the client. No-ops on the web build
 * (plugins are dynamically imported and guarded by isNativePlatform), so the
 * static export keeps working in a normal browser.
 */
export function NativeInit() {
  useEffect(() => {
    let cancelled = false;

    // Start viewport/keyboard tracking on every platform (web uses the visual
    // viewport, native uses the Keyboard plugin).
    void initKeyboardViewport();

    // Warm every cold DB path at launch so the first real interaction is fast.
    // On a cold cache these first calls take seconds; firing them here means the
    // relevant tables/indexes/query plans are already hot by the time the user
    // navigates in. We warm:
    //   * reference data (clubs / national teams) for the selectors,
    //   * player search (first autocomplete query),
    //   * sp_random_challenge (Solo "Start"), for both modes,
    //   * the Lookup RPCs (get_players_for_*) — using the valid combo the solo
    //     challenge returns so the exact lookup query path + get_player_profile
    //     are warm before the user's first search.
    // All fire-and-forget.
    try {
      const db = getSupabaseBrowserClient();
      void fetchClubs(db);
      void fetchNationalTeams(db);
      void searchPlayers(db, "war").catch(() => {});

      void getSoloChallenge(db, {
        mode: "national_club",
        difficulty: "easy",
        league: null,
      })
        .then((ch) => {
          if (ch?.national_team_id && ch?.club_1_id) {
            void getPlayersForCountryClub(db, ch.national_team_id, ch.club_1_id)
              .then((players) => {
                const first = players[0]?.player_id;
                if (first) void prefetchPlayerProfile(db, first).catch(() => {});
              })
              .catch(() => {});
          }
        })
        .catch(() => {});

      void getSoloChallenge(db, {
        mode: "club_club",
        difficulty: "easy",
        league: null,
      })
        .then((ch) => {
          if (ch?.club_1_id && ch?.club_2_id) {
            void getPlayersForClubClub(db, ch.club_1_id, ch.club_2_id).catch(
              () => {},
            );
          }
        })
        .catch(() => {});
    } catch {
      /* best-effort preload */
    }

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

      // Don't let iOS resize the webview or auto-scroll: it fights our own
      // keyboard-aware layout (getViewportBottom / --kb-inset / DropdownPortal)
      // and delayed the lift until typing. With `None` the keyboard simply
      // overlays; we reserve scroll room (--kb-inset) and lift the focused field
      // ourselves the instant it's tapped.
      try {
        await Keyboard.setResizeMode({ mode: KeyboardResize.None });
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
