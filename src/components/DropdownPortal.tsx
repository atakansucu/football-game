"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  getViewportBottom,
  getViewportTop,
  subscribeViewport,
} from "@/lib/keyboard";
import { EASE_OUT } from "@/lib/easing";

interface Rect {
  left: number;
  width: number;
  /** Anchored below the input… */
  top?: number;
  /** …or above it (flipped) when there isn't room below (e.g. keyboard open). */
  bottom?: number;
  maxHeight: number;
}

/** Space (px) we try to reserve for the list before deciding to flip upward. */
const PREFERRED = 240;
const GAP = 6;
/**
 * When flipped, keep at least this much clearance between the list's top edge
 * and the top of the usable viewport (below the notch / Dynamic Island).
 */
const TOP_MARGIN = 8;
/** Smallest usable list height; below/above this we'd rather still show it. */
const MIN_HEIGHT = 96;

interface DropdownPortalProps {
  /** The element the dropdown should anchor to (usually the text input). */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  className?: string;
  onMouseDown?: (e: React.MouseEvent) => void;
  /**
   * "auto" flips above the anchor when there's little room below (used in the
   * game, where the field can't scroll up because the timer must stay visible).
   * "below" always anchors below and simply caps its height at the keyboard,
   * relying on the caller to scroll the field up so there's room.
   */
  placement?: "auto" | "below";
  children: ReactNode;
}

/**
 * Renders a dropdown into `document.body` with fixed positioning anchored below
 * the given element. Escaping to the body guarantees the list is painted above
 * everything else, regardless of parent stacking contexts (e.g. cards using
 * `backdrop-filter`), so it can never end up behind other content.
 */
export function DropdownPortal({
  anchorRef,
  open,
  className,
  onMouseDown,
  placement = "auto",
  children,
}: DropdownPortalProps) {
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // Keep the last measured rect while closing so the exit animation has a
    // position to animate from; `open` gates visibility via AnimatePresence.
    if (!open) return;

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // getViewportBottom() already excludes the on-screen keyboard (and knows
      // the final keyboard height immediately on native), so the list is sized
      // correctly on the very first frame — no "open tall then shrink".
      const viewportTop = getViewportTop();
      const viewportBottom = getViewportBottom();
      const spaceBelow = viewportBottom - r.bottom;
      const spaceAbove = r.top - viewportTop;
      // In "below" mode we always anchor beneath the field. In "auto" we flip
      // above when the field sits too low for a usable list below it (so the
      // keyboard can never cover it).
      const flip =
        placement === "auto" && spaceBelow < PREFERRED && spaceAbove > spaceBelow;

      if (flip) {
        // The list is anchored by its BOTTOM edge (so it visually grows out of
        // the field). Its bottom sits `GAP` above the field's top; measured from
        // the top of the layout viewport that's `r.top - GAP`.
        const bottomEdge = r.top - GAP;
        // Hard clamp: the top edge must NEVER cross into the notch. The most a
        // bottom-anchored list can rise is `bottomEdge - maxHeight`, so capping
        // maxHeight at the room above the safe line guarantees
        // `top >= viewportTop + TOP_MARGIN` regardless of how tall the content is.
        const maxHeight = Math.max(0, bottomEdge - (viewportTop + TOP_MARGIN));
        setRect({
          left: r.left,
          width: r.width,
          bottom: window.innerHeight - r.top + GAP,
          maxHeight,
        });
      } else {
        const maxHeight = Math.max(MIN_HEIGHT, spaceBelow - GAP - 8);
        setRect({ left: r.left, width: r.width, top: r.bottom + GAP, maxHeight });
      }
    };

    update();
    const unsubscribe = subscribeViewport(update);
    // Capture-phase scroll catches scrolling in any ancestor container.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      unsubscribe();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef, placement]);

  if (!mounted) return null;

  // Flipped dropdowns are anchored by `bottom`, so they should scale out of
  // their bottom edge; ones anchored below scale out of the top — the panel
  // should look like it grew from the field it belongs to.
  const flipped = rect?.bottom != null;

  return createPortal(
    <AnimatePresence>
      {open && rect && (
        <motion.ul
          key="dropdown"
          className={className}
          onMouseDown={onMouseDown}
          initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "scale(0.96)" }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, transform: "scale(1)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, transform: "scale(0.96)" }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
          style={{
            position: "fixed",
            left: rect.left,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            maxHeight: rect.maxHeight,
            transformOrigin: flipped ? "bottom center" : "top center",
            zIndex: 1000,
          }}
        >
          {children}
        </motion.ul>
      )}
    </AnimatePresence>,
    document.body,
  );
}
