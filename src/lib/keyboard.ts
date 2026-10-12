/**
 * Tracks the usable viewport (the area NOT covered by the on-screen keyboard)
 * and lets components react to it synchronously.
 *
 * On native iOS we read the keyboard height straight from the Capacitor
 * Keyboard plugin's `keyboardWillShow`/`keyboardWillHide` events, which fire
 * with the FINAL keyboard height immediately — before the webview finishes its
 * resize animation. That lets dropdowns place themselves correctly on the first
 * frame instead of opening full-height and then shrinking as the keyboard rises.
 *
 * On the web we fall back to `window.visualViewport`.
 */

let nativeKeyboardHeight = 0;
// Last non-zero keyboard height we've seen — used to PREDICT placement on the
// very first frame after a field is focused, before keyboardWillShow fires.
let lastKeyboardHeight = 0;
// Set the moment a text field is focused, so getViewportBottom() can predict
// the keyboard before the OS reports it. Cleared on show or after a timeout.
let expecting = false;
let expectTimer: ReturnType<typeof setTimeout> | null = null;
// The viewport height while no keyboard is shown (updated on rotation etc.).
let baseInnerHeight = 0;
// Top safe-area inset (notch / Dynamic Island) in px.
let safeTop = 0;
let initialized = false;
let isNative = false;

const KB_KEY = "fd-kb-h";

function loadLastKeyboardHeight(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = parseFloat(window.localStorage.getItem(KB_KEY) ?? "");
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Measure the top safe-area inset (notch / Dynamic Island) in px.
 *
 * We can't read this from a CSS custom property: `getComputedStyle` returns the
 * unresolved `env(safe-area-inset-top)` string, not a pixel value. Instead we
 * render a hidden probe sized by `env()` and read the RESOLVED pixel value.
 *
 * WebKit has been flaky about which property surface resolves `env()` reliably,
 * so we measure TWO ways and take the larger:
 *   1. `getBoundingClientRect().height` of an element whose `height` is
 *      `env(safe-area-inset-top)` — the actual laid-out pixel height, which is
 *      the most trustworthy source.
 *   2. the computed `padding-top` of an element padded by `env()`.
 * On an iPhone 16 Pro this yields ~59px; on non-notch devices it's 0.
 */
function measureSafeTop(): number {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  // `height` carries the inset so getBoundingClientRect() reports it directly;
  // `padding-top` gives us an independent computed-style reading as a backup.
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;" +
    "height:env(safe-area-inset-top,0px);padding-top:env(safe-area-inset-top,0px);";
  document.body.appendChild(probe);
  const byRect = probe.getBoundingClientRect().height;
  const byPadding = parseFloat(getComputedStyle(probe).paddingTop);
  probe.remove();
  const a = Number.isFinite(byRect) ? byRect : 0;
  const b = Number.isFinite(byPadding) ? byPadding : 0;
  return Math.max(a, b, 0);
}

/**
 * Refresh the cached `safeTop`, but NEVER let a transient 0 read clobber a good
 * value. WebKit occasionally reports `env(safe-area-inset-top)` as 0 mid-launch
 * or during keyboard transitions; once we've measured the real inset we keep it
 * (the notch doesn't move in portrait) so flipped dropdowns always clamp below
 * the Dynamic Island. A genuine larger value (e.g. rotation) still updates it.
 */
function refreshSafeTop(): void {
  const measured = measureSafeTop();
  if (measured > 0) safeTop = measured;
}

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/**
 * Reserve scroll room at the bottom of `.app-shell` equal to the keyboard
 * height (via the `--kb-inset` CSS var). Without this the focused field can't be
 * scrolled clear of the keyboard on tap — there's simply nothing to scroll into
 * until later content (dropdown / feedback) grows the page, which is why the
 * lift used to only happen once you started typing.
 */
function applyKbInset(px: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--kb-inset",
    `${Math.max(0, Math.round(px))}px`,
  );
}

/** Subscribe to viewport changes (keyboard show/hide, rotation). */
export function subscribeViewport(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Signal that a text field just received focus (so a keyboard is imminent).
 * Lets dropdowns place themselves correctly on the first frame.
 */
export function setKeyboardExpected(): void {
  if (!isNative) return;
  expecting = true;
  // Reserve the scroll room immediately (predicted height) so the field can be
  // lifted on the very first frame after the tap — not only once typing grows
  // the page.
  if (lastKeyboardHeight > 0) applyKbInset(lastKeyboardHeight);
  if (expectTimer) clearTimeout(expectTimer);
  expectTimer = setTimeout(() => {
    expecting = false;
    // If the keyboard never actually showed, drop the reserved room again.
    if (nativeKeyboardHeight === 0) applyKbInset(0);
    emit();
  }, 800);
  emit();
}

/** Bottom edge (px from the top of the layout viewport) that stays visible. */
export function getViewportBottom(): number {
  if (typeof window === "undefined") return 0;
  if (isNative) {
    if (nativeKeyboardHeight > 0) {
      return Math.max(0, baseInnerHeight - nativeKeyboardHeight);
    }
    // Keyboard is on its way but the OS hasn't reported it yet: predict using
    // the last known height so the list opens in the right spot immediately.
    if (expecting && lastKeyboardHeight > 0) {
      return Math.max(0, baseInnerHeight - lastKeyboardHeight);
    }
    return window.innerHeight;
  }
  const vv = window.visualViewport;
  if (vv) return vv.offsetTop + vv.height;
  return window.innerHeight;
}

/** Top edge (px) of the usable viewport, kept below the notch / status bar. */
export function getViewportTop(): number {
  if (typeof window === "undefined") return 0;
  const vvTop = window.visualViewport?.offsetTop ?? 0;
  return Math.max(safeTop, vvTop);
}

// The field that most recently received focus, lifted the moment the keyboard
// is about to show (native) or after a short settle (web).
let pendingFocusEl: HTMLElement | null = null;

/**
 * Nudge the field just clear of the keyboard (ONCE) — the MINIMUM scroll needed
 * so what you're typing is visible, without pulling it to the top (the teams /
 * challenge above it stay on screen).
 */
function scrollElementUp(el: HTMLElement | null): void {
  if (typeof window === "undefined" || !el) return;
  const scroller = el.closest(".app-shell") as HTMLElement | null;
  if (!scroller) return;
  const rect = el.getBoundingClientRect();
  const margin = 12;
  const overflow = rect.bottom - (getViewportBottom() - margin);
  if (overflow > 8) scroller.scrollBy({ top: overflow, behavior: "smooth" });
}

/**
 * Call from a text field's onFocus. We lift the field the INSTANT the field is
 * tapped — not when the user starts typing. On native we scroll immediately
 * using the predicted keyboard height and again on keyboardWillShow (correction
 * once the real height is known); on web we nudge after the viewport settles.
 */
export function onFieldFocus(el: HTMLElement | null): void {
  pendingFocusEl = el;
  // Refresh the notch inset right before a dropdown can open, so flipped lists
  // (e.g. Player Lookup) clamp their top below the Dynamic Island even if the
  // value wasn't available at init time.
  refreshSafeTop();
  setKeyboardExpected();
  if (isNative) {
    // Predicted height is already reflected in getViewportBottom() via the
    // `expecting` flag, so this moves the field up right away on tap.
    requestAnimationFrame(() => scrollElementUp(el));
  } else {
    // If the keyboard is already open (switching fields) no viewport resize
    // fires, so lift immediately. When it isn't open yet, the visualViewport
    // `resize` handler lifts the field the moment the keyboard appears (right
    // after the tap). The timeout is a last-resort fallback.
    requestAnimationFrame(() => scrollElementUp(el));
    setTimeout(() => scrollElementUp(el), 300);
  }
}

/**
 * Dismiss the on-screen keyboard: blur whatever field is focused and, on
 * native, ask the Keyboard plugin to hide it. Used when a selection is complete
 * (e.g. both Player Lookup teams chosen) so the keyboard doesn't linger.
 */
export function dismissKeyboard(): void {
  pendingFocusEl = null;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (active instanceof HTMLElement) active.blur();
  if (isNative) {
    void import("@capacitor/keyboard")
      .then(({ Keyboard }) => Keyboard.hide())
      .catch(() => {});
  }
}

/**
 * Wire up the platform listeners once. Safe to call on the web (it just uses
 * the visual viewport) and idempotent.
 */
export async function initKeyboardViewport(): Promise<void> {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  baseInnerHeight = window.innerHeight;
  refreshSafeTop();

  const { Capacitor } = await import("@capacitor/core");
  isNative = Capacitor.isNativePlatform();

  // Seed the predicted keyboard height from a previous session, or a sensible
  // default so even the very first focus after install is close.
  if (isNative) {
    lastKeyboardHeight = loadLastKeyboardHeight() || 336;
  }

  window.addEventListener("resize", () => {
    // Only refresh the base height while no keyboard is up, otherwise the
    // mid-animation resize would corrupt our prediction.
    if (!isNative || nativeKeyboardHeight === 0) {
      baseInnerHeight = window.innerHeight;
    }
    refreshSafeTop();
    emit();
  });

  if (isNative) {
    const { Keyboard } = await import("@capacitor/keyboard");
    await Keyboard.addListener("keyboardWillShow", (info) => {
      nativeKeyboardHeight = info.keyboardHeight || 0;
      if (nativeKeyboardHeight > 0) {
        lastKeyboardHeight = nativeKeyboardHeight;
        // Correct the reserved scroll room to the real keyboard height.
        applyKbInset(nativeKeyboardHeight);
        try {
          window.localStorage.setItem(KB_KEY, String(nativeKeyboardHeight));
        } catch {
          /* non-fatal */
        }
      }
      expecting = false;
      if (expectTimer) clearTimeout(expectTimer);
      emit();
      // Correct the lift once the real keyboard height is known (minimal, so it
      // never over-scrolls or fights iOS's own resize).
      requestAnimationFrame(() => scrollElementUp(pendingFocusEl));
    });
    await Keyboard.addListener("keyboardWillHide", () => {
      nativeKeyboardHeight = 0;
      applyKbInset(0);
      pendingFocusEl = null;
      emit();
    });
  } else {
    const vv = window.visualViewport;
    vv?.addEventListener("resize", () => {
      // On mobile web the visual viewport shrinks by the keyboard height while
      // the layout viewport stays; mirror that as scroll room.
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      applyKbInset(occluded);
      // The viewport resize IS the keyboard opening (right after the tap). Lift
      // the just-focused field now, so it happens on tap — not once the browser
      // decides to scroll while you're typing.
      if (occluded > 0) {
        if (pendingFocusEl) scrollElementUp(pendingFocusEl);
      } else {
        pendingFocusEl = null;
      }
      emit();
    });
    vv?.addEventListener("scroll", emit);
  }
}
