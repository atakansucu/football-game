/**
 * Shared motion curves (Emil Kowalski's design-eng philosophy), mirrored from
 * the CSS custom properties in globals.css so JS (Motion) and CSS use the exact
 * same easing. The built-in curves are too weak; these give animations punch.
 */

/** Strong ease-out for UI enter/exit — matches `--ease-out`. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** Strong ease-in-out for on-screen movement — matches `--ease-in-out`. */
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
