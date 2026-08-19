"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface Rect {
  left: number;
  top: number;
  width: number;
}

interface DropdownPortalProps {
  /** The element the dropdown should anchor to (usually the text input). */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  className?: string;
  onMouseDown?: (e: React.MouseEvent) => void;
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
  children,
}: DropdownPortalProps) {
  const [mounted, setMounted] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    // Capture-phase scroll catches scrolling in any ancestor container.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef]);

  if (!open || !mounted || !rect) return null;

  return createPortal(
    <ul
      className={className}
      onMouseDown={onMouseDown}
      style={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        zIndex: 1000,
      }}
    >
      {children}
    </ul>,
    document.body,
  );
}
