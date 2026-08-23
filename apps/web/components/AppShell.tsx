"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Container, IconButton } from "@radix-ui/themes";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { SettingsDialog } from "./SettingsDialog";

/**
 * The app shell (story #97): a three-column-ready chrome — header, resizable
 * and foldable left side nav, center content column — built on Radix Themes'
 * default theme. Custom CSS is limited to the layout mechanics in shell.css;
 * the state here (width, folded, drawer) is the only client-side shell state.
 *
 * - Desktop (>= 768px): the side nav sits in flow; a drag handle resizes it,
 *   bounded by a 360px minimum center column; the in-nav hamburger folds it
 *   away and a header hamburger brings it back.
 * - Below 768px: the side nav becomes an overlay drawer opened from the
 *   header hamburger; it never pushes the content.
 * - Width and folded state persist in localStorage.
 */

const WIDTH_KEY = "dsh-next-app.sidebar.width";
const FOLDED_KEY = "dsh-next-app.sidebar.folded";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 160;
const CENTER_MIN = 360;
const DESKTOP_QUERY = "(min-width: 768px)";
const RESIZE_STEP = 16;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export function AppShell({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [folded, setFolded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(DEFAULT_WIDTH);
  const dragStart = useRef({ x: 0, width: DEFAULT_WIDTH });

  // Breakpoint tracking; leaving mobile mode closes the drawer.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const apply = (): void => {
      setIsMobile(!mq.matches);
      if (mq.matches) setDrawerOpen(false);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Persisted sidebar preferences (width + folded state).
  useEffect(() => {
    try {
      const storedWidth = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(storedWidth) && storedWidth >= MIN_WIDTH) {
        setWidth(Math.round(storedWidth));
      }
      setFolded(window.localStorage.getItem(FOLDED_KEY) === "1");
    } catch {
      // Storage unavailable (private mode, file origin): keep defaults.
    }
  }, []);

  widthRef.current = width;
  const navShown = isMobile ? drawerOpen : !folded;

  const persistWidth = (value: number): void => {
    try {
      window.localStorage.setItem(WIDTH_KEY, String(Math.round(value)));
    } catch {
      // Storage unavailable: the in-memory width still applies.
    }
  };

  const toggleNav = (): void => {
    if (isMobile) {
      setDrawerOpen((open) => !open);
      return;
    }
    const next = !folded;
    setFolded(next);
    try {
      window.localStorage.setItem(FOLDED_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable: the in-memory state still applies.
    }
  };

  const maxWidth = (): number => Math.max(MIN_WIDTH, window.innerWidth - CENTER_MIN);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (isMobile) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, width: widthRef.current };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    const next = clamp(
      dragStart.current.width + event.clientX - dragStart.current.x,
      MIN_WIDTH,
      maxWidth(),
    );
    setWidth(next);
  };

  const handlePointerEnd = (): void => {
    if (!dragging) return;
    setDragging(false);
    persistWidth(widthRef.current);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP;
    setWidth((current) => {
      const next = clamp(current + delta, MIN_WIDTH, maxWidth());
      persistWidth(next);
      return next;
    });
  };

  const shellStyle = {
    "--sidebar-w": `${folded ? 0 : width}px`,
  } as CSSProperties;

  return (
    <div
      className="shell"
      style={shellStyle}
      data-folded={folded || undefined}
      data-drawer-open={drawerOpen || undefined}
      data-dragging={dragging || undefined}
    >
      <header className="shell-header">
        <a className="shell-brand" href="/sessions">
          dsh-next-app
        </a>
        <IconButton
          className="shell-header-toggle"
          aria-label="Open navigation"
          aria-expanded={navShown}
          aria-controls="shell-sidebar"
          variant="ghost"
          color="gray"
          onClick={toggleNav}
        >
          <HamburgerMenuIcon width="16" height="16" />
        </IconButton>
      </header>
      <nav id="shell-sidebar" className="shell-sidebar" aria-label="Primary" inert={!navShown}>
        <IconButton
          className="shell-sidebar-toggle"
          aria-label="Close navigation"
          aria-expanded={navShown}
          aria-controls="shell-sidebar"
          variant="ghost"
          color="gray"
          onClick={toggleNav}
        >
          <HamburgerMenuIcon width="16" height="16" />
        </IconButton>
        <div className="shell-sidebar-list" />
        <div className="shell-sidebar-bottom">
          <SettingsDialog />
        </div>
        <div
          className="shell-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onKeyDown={handleResizeKeyDown}
        />
      </nav>
      <main className="shell-main">
        <Container size="3" px="6" py="4">
          {children}
        </Container>
      </main>
    </div>
  );
}
