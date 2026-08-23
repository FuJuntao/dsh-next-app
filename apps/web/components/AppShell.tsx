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

  // Breakpoint tracking without a hardcoded pixel value: the side nav's
  // position is itself a Radix-responsive property (fixed below its sm
  // breakpoint, relative above), so the computed style IS the breakpoint
  // state. Leaving mobile mode closes the drawer.
  useEffect(() => {
    const nav = document.getElementById("shell-sidebar");
    if (!nav) return;
    const apply = (): void => {
      const mobile = getComputedStyle(nav).position === "fixed";
      setIsMobile(mobile);
      if (!mobile) setDrawerOpen(false);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
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
      // The grid template rides Radix's responsive props: its base .rt-Grid
      // rule (unlayered) would beat any layered Tailwind utility on the same
      // property, while Tailwind owns what Radix never sets (transforms,
      // borders, selection).
      className="group data-[dragging=true]:select-none"
      style={shellStyle}
      data-folded={folded || undefined}
      data-drawer-open={drawerOpen || undefined}
      data-dragging={dragging || undefined}
      columns={{
        initial: "minmax(0, 1fr)",
        // The sidebar column is capped by the center-min so a stored width
        // from a wider screen (or a hand-edited prefs cookie) can never
        // overflow the shell (review finding: AC-5 no-overflow).
        sm: "min(var(--sidebar-w), calc(100% - 360px)) minmax(360px, 1fr) var(--right-w)",
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
      >
        <header className="border-b border-[var(--gray-a5)]">
          <IconButton
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
      >
        <nav
          id="shell-sidebar"
          aria-label="Primary"
          inert={!navShown}
          className="border-r border-[var(--gray-a5)] -translate-x-full transition-transform group-data-[drawer-open=true]:translate-x-0 max-md:bg-[var(--color-panel)] max-md:z-20 md:translate-x-0 md:group-data-[folded=true]:-translate-x-[100vw]"
        >
          <IconButton
            aria-label="Close navigation"
            aria-expanded={navShown}
            aria-controls="shell-sidebar"
            variant="ghost"
            color="gray"
            m="2"
            className="self-start md:hidden!"
            onClick={toggleNav}
          >
            <HamburgerMenuIcon width="16" height="16" />
          </IconButton>
          <Box flexGrow="1" minHeight="0" overflowY="auto" />
          <Flex justify="center" p="2" className="border-t border-[var(--gray-a5)]">
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
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            tabIndex={0}
            position="absolute"
            top="0"
            bottom="0"
            right="0"
            width="10px"
            className="z-[2] hidden cursor-col-resize touch-none md:block"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleResizeKeyDown}
          />
        </nav>
      </Flex>
      <Box asChild gridColumn={{ initial: "1", sm: "2" }} gridRow="2" overflowY="auto" minWidth="0">
        <main>
          <Container size={{ initial: "2", sm: "3" }} px="6" py="4">
            {children}
          </Container>
        </main>
      </Box>
    </Grid>
  );
}
