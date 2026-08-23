"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Box, Container, Flex, Grid, IconButton } from "@radix-ui/themes";
import { GearIcon, HamburgerMenuIcon } from "@radix-ui/react-icons";
import { PREFERENCES_COOKIE, encodePreferences } from "../lib/preferences";

/**
 * The app shell (story #97): a three-column-ready chrome — header, resizable
 * and foldable left side nav, center content column — built on Radix Themes'
 * default theme. Structure and responsive behavior come from Radix layout
 * primitives (Grid/Flex/Box) and their responsive props; shell.css holds
 * only what Radix cannot express (transforms, the drag handle interaction,
 * display toggles, the body reset). The state here (width, folded, drawer)
 * is the only client-side shell state; prefs ride the preferences cookie
 * so the server renders them into the first HTML.
 *
 * - Desktop (>= 768px, Radix sm): the side nav sits in flow; a drag handle
 *   resizes it, bounded by a 360px minimum center column; the always-visible
 *   header toggle folds it away.
 * - Below 768px: the side nav becomes an overlay drawer opened from the
 *   header toggle; it never pushes the content.
 */

const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 160;
const CENTER_MIN = 360;
const DESKTOP_QUERY = "(min-width: 768px)";
const RESIZE_STEP = 16;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Persist the shell prefs to the cookie the server renders from (no flash). */
function persistShell(width: number, folded: boolean): void {
  try {
    const prefs = encodePreferences({
      layout: { width: Math.round(width), folded },
    });
    document.cookie = `${PREFERENCES_COOKIE}=${prefs};path=/;max-age=31536000;samesite=lax`;
  } catch {
    // Storage unavailable: the in-memory state still applies.
  }
}

export function AppShell({
  children,
  initialWidth,
  initialFolded,
}: {
  children: ReactNode;
  initialWidth?: number;
  initialFolded?: boolean;
}) {
  const router = useRouter();
  const [width, setWidth] = useState(() =>
    Math.max(MIN_WIDTH, Math.round(initialWidth ?? DEFAULT_WIDTH)),
  );
  const [folded, setFolded] = useState(initialFolded ?? false);
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

  widthRef.current = width;
  const navShown = isMobile ? drawerOpen : !folded;

  const toggleNav = (): void => {
    if (isMobile) {
      setDrawerOpen((open) => !open);
      return;
    }
    const next = !folded;
    setFolded(next);
    persistShell(widthRef.current, next);
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
    persistShell(widthRef.current, folded);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -RESIZE_STEP : RESIZE_STEP;
    setWidth((current) => {
      const next = clamp(current + delta, MIN_WIDTH, maxWidth());
      persistShell(next, folded);
      return next;
    });
  };

  const shellStyle = {
    "--sidebar-w": `${folded ? 0 : width}px`,
    "--right-w": "0px",
  } as CSSProperties;

  return (
    <Grid
      className="shell"
      style={shellStyle}
      data-folded={folded || undefined}
      data-drawer-open={drawerOpen || undefined}
      data-dragging={dragging || undefined}
      columns={{
        initial: "minmax(0, 1fr)",
        sm: "var(--sidebar-w) minmax(360px, 1fr) var(--right-w)",
      }}
      rows="auto 1fr"
      height="100dvh"
    >
      <Flex
        asChild
        gridColumn={{ initial: "1", sm: "2" }}
        gridRow="1"
        align="center"
        gap="3"
        px="4"
        style={{ borderBottom: "1px solid var(--gray-a5)" }}
      >
        <header className="shell-header">
          <IconButton
            className="shell-header-toggle"
            aria-label="Toggle navigation"
            aria-expanded={navShown}
            aria-controls="shell-sidebar"
            variant="ghost"
            color="gray"
            onClick={toggleNav}
          >
            <HamburgerMenuIcon width="16" height="16" />
          </IconButton>
        </header>
      </Flex>
      <Flex
        asChild
        gridColumn="1"
        gridRow="1 / -1"
        direction="column"
        position={{ initial: "fixed", sm: "relative" }}
        top={{ initial: "0", sm: "auto" }}
        bottom={{ initial: "0", sm: "auto" }}
        left={{ initial: "0", sm: "auto" }}
        width={{ initial: "min(var(--sidebar-w), 80vw)", sm: "auto" }}
        overflow="hidden"
        minWidth="0"
        style={{ borderRight: "1px solid var(--gray-a5)" }}
      >
        <nav id="shell-sidebar" className="shell-sidebar" aria-label="Primary" inert={!navShown}>
          <IconButton
            className="shell-sidebar-toggle"
            aria-label="Close navigation"
            aria-expanded={navShown}
            aria-controls="shell-sidebar"
            variant="ghost"
            color="gray"
            m="2"
            style={{ alignSelf: "flex-start" }}
            onClick={toggleNav}
          >
            <HamburgerMenuIcon width="16" height="16" />
          </IconButton>
          <Box className="shell-sidebar-list" flexGrow="1" minHeight="0" overflowY="auto" />
          <Flex
            className="shell-sidebar-bottom"
            justify="center"
            p="2"
            style={{ borderTop: "1px solid var(--gray-a5)" }}
          >
            <IconButton
              aria-label="Settings"
              variant="ghost"
              color="gray"
              size="2"
              onClick={() => router.push("/settings")}
            >
              <GearIcon width="16" height="16" />
            </IconButton>
          </Flex>
          <Box
            className="shell-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            tabIndex={0}
            position="absolute"
            top="0"
            bottom="0"
            right="0"
            width="10px"
            style={{ cursor: "col-resize", touchAction: "none", zIndex: 2 }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleResizeKeyDown}
          />
        </nav>
      </Flex>
      <Box asChild gridColumn={{ initial: "1", sm: "2" }} gridRow="2" overflowY="auto" minWidth="0">
        <main className="shell-main">
          <Container size={{ initial: "2", sm: "3" }} px="6" py="4">
            {children}
          </Container>
        </main>
      </Box>
    </Grid>
  );
}
