import * as React from "react";

// The shell's mobile/desktop split. Single source: globals.css declares
// --breakpoint-md on :root (mirroring the @theme literal Tailwind's md:
// variants compile from) - this hook reads the same value, so JS and CSS
// can never drift. Lengths resolve like media queries do: rem units use
// the initial font-size (16px), not the document's.
const FALLBACK_BREAKPOINT = 768;

function readBreakpoint(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-md").trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return FALLBACK_BREAKPOINT;
  return raw.endsWith("rem") ? value * 16 : value;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const breakpoint = readBreakpoint();
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
