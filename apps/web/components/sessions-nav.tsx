"use client";

/**
 * The side nav sessions list (story #107 task #109).
 *
 * Server-computed first paint: the root layout fetches the live rows
 * through the bridge (ADR-0010) and reads the prefs cookie, passing both
 * down; this component runs the pure arrangeSessions (lib/session-view.ts)
 * over them - identical inputs on server and client, so hydration matches.
 * Interactive control changes re-run the same arrangement in place and
 * write the prefs cookie through updatePreferences; the server picks the
 * change up on its next request-render cycle (AC 3-5).
 *
 * Rows carry the full AC 2 content: title, running dot, relative
 * last-activity time, subagent children nested beneath their parent, links
 * to /sessions/<id> with the active row highlighted. Bridge-down keeps
 * task #108's distinct error state with Retry - never stale placeholder
 * rows (AC 6). Rows order by last activity - the session.list wire order;
 * grouping is the one user choice (revised scope: recency covers what a
 * sort control added, so it was dropped before review).
 *
 * Fold and paging (story #148 task #149): every workspace group is headed
 * by a toggle button that folds the whole group, and its window shows at
 * most SESSION_PAGE_SIZE top-level rows with Show {n} more / Show less
 * stepping between pages. Both states live in component state keyed by the
 * group's cwd - ephemeral by design (AC 5): they survive client-side
 * navigation, reset on a full reload, and never enter the prefs cookie.
 * The window itself is cut by the pure sessionPage helper, so the folded/
 * paged arrangement is what the server paints and hydration matches (AC 6);
 * the page seeded for the active session keeps a deep link honest too.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCloudOffLine,
  RiFolderLine,
  RiFolderOpenLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { navSnapshot, navTitleOf, subscribeNavLive } from "../lib/nav-live";
import { updatePreferences } from "../lib/preferences";
import type { SessionsResult } from "../lib/sessions";
import {
  DEFAULT_GROUP,
  arrangeSessions,
  formatRelativeTime,
  sessionPage,
  sessionPageOf,
  type SessionGroup,
  type SessionGroupMode,
  type SessionRow,
} from "../lib/session-view";

/** One header pick-list: an icon trigger opening a radio group. */
function HeaderPicker({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  /** Accessible name for the trigger; the icon alone carries nothing. */
  label: string;
  icon: React.ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        className="inline-flex size-5 items-center justify-center rounded-sm text-sidebar-foreground/60 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
      >
        {icon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The running-state dot (AC 2): filled emerald while attached agents run. */
function RunningDot({ running }: { running: boolean }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={
          "size-1.5 shrink-0 rounded-full " + (running ? "bg-success" : "bg-muted-foreground/30")
        }
      />
      <span className="sr-only">{running ? "running" : "idle"}</span>
    </>
  );
}

/** Shared row body: dot, truncated title, relative last-activity time. */
function RowButton({
  row,
  active,
  onNavigate,
}: {
  row: SessionRow;
  active: boolean;
  onNavigate: () => void;
}) {
  const { session } = row;
  return (
    <SidebarMenuButton
      isActive={active}
      render={<Link href={"/sessions/" + session.id} onClick={onNavigate} />}
    >
      <RunningDot running={session.running} />
      <span className="truncate">{session.title}</span>
      <time
        dateTime={new Date(session.updatedAt).toISOString()}
        suppressHydrationWarning
        className="ml-auto shrink-0 text-2xs tabular-nums text-sidebar-foreground/50"
      >
        {formatRelativeTime(session.updatedAt)}
      </time>
    </SidebarMenuButton>
  );
}

/**
 * One session row at any lineage depth: the row body, then its nested
 * children rendered as the same node one indent deeper (recursion runs to
 * full depth - a dropped grandchild would be a silently vanished row).
 */
function RowNode({
  row,
  activePathname,
  onNavigate,
}: {
  row: SessionRow;
  activePathname: string;
  onNavigate: () => void;
}) {
  return (
    <SidebarMenuItem data-session-id={row.session.id}>
      <RowButton
        row={row}
        active={activePathname === "/sessions/" + row.session.id}
        onNavigate={onNavigate}
      />
      {row.children.length > 0 && (
        <ul className="ml-5 border-l border-sidebar-border pl-1">
          {row.children.map((child) => (
            <RowNode
              key={child.session.id}
              row={child}
              activePathname={activePathname}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </SidebarMenuItem>
  );
}

/**
 * Pager control styling: the list's own visual language (sidebar-accent
 * hover and focus ring, like every row) at a quiet tone, so the control
 * reads as a line of the list rather than a stray button from the main
 * surface's palette. The geometry matches a row exactly: same p-2/gap-2,
 * and the wider chevron carries -mx-1 so it occupies the 6px status-dot
 * slot - the label then starts on the same x as every session title.
 */
const PAGER_BUTTON_CLASS =
  "flex h-7 items-center gap-2 rounded-sm px-2 text-xs text-sidebar-foreground/60 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";
const PAGER_ICON_CLASS = "size-3.5 -mx-1 shrink-0";

/**
 * One arranged group: a foldable workspace header, then the current page's
 * parents with their nested children, then the pager controls. An unlabelled
 * group is the flat view - no header, no fold, no page budget (#148
 * non-goal), so it renders every row.
 */
function RowGroup({
  group,
  folded,
  page,
  activePathname,
  onNavigate,
  onFoldToggle,
  onPageChange,
}: {
  group: SessionGroup;
  folded: boolean;
  /** The stored 1-based page; sessionPage clamps it against the live rows. */
  page: number;
  activePathname: string;
  onNavigate: () => void;
  onFoldToggle: () => void;
  onPageChange: (page: number) => void;
}) {
  const paged = sessionPage(group.rows, page);
  const pagedGroup = group.label !== undefined;
  return (
    <div data-testid={"session-group-" + group.key}>
      {pagedGroup && (
        // The whole header row is the tap target (AC 7): the folder glyph is
        // the persistent expand-state chevron - hover-revealed affordances
        // are untappable on touch, which is where we deliberately diverge
        // from the built-in nav's hover chevron. Reopening returns to
        // page 1 (AC 3), so the toggle never preserves a page across folds.
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls={"session-list-" + group.key}
          data-testid={"session-fold-" + group.key}
          title={group.detail}
          onClick={onFoldToggle}
          className="flex w-full items-center gap-1 rounded-sm px-2 pt-2 pb-1 text-left text-2xs font-medium text-sidebar-foreground/50 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground"
        >
          {folded ? (
            <RiFolderLine aria-hidden="true" className="size-3 shrink-0" />
          ) : (
            <RiFolderOpenLine aria-hidden="true" className="size-3 shrink-0" />
          )}
          <span className="truncate">{group.label}</span>
          {/* Session count beside the name (AC 3): the top-level rows the
              pager does its budget arithmetic on, as in the built-in nav.
              The visible digit is aria-hidden and a screen-reader span
              carries it with its unit, so the disclosure control's name
              ends "... 13 sessions", never a bare number (review #5). */}
          <span aria-hidden="true" className="ml-auto shrink-0 tabular-nums">
            {group.rows.length}
          </span>
          <span className="sr-only">
            {group.rows.length} {group.rows.length === 1 ? "session" : "sessions"}
          </span>
        </button>
      )}
      {!folded && (
        <>
          {/* In the grouped view the rows indent beneath the folder label so
              the hierarchy reads as folder -> sessions (the flat view stays
              flush with the rest of the nav). The flat view is also NOT
              windowed (#148 non-goal): the budget applies to grouped
              headers only, so the uncapped rows render from group.rows. */}
          <SidebarMenu id={"session-list-" + group.key} className={pagedGroup ? "pl-4" : undefined}>
            {(pagedGroup ? paged.rows : group.rows).map((row) => (
              <RowNode
                key={row.session.id}
                row={row}
                activePathname={activePathname}
                onNavigate={onNavigate}
              />
            ))}
            {pagedGroup &&
              (paged.moreCount > 0 || paged.page > 1) && (
                // Pager row (AC 2): Show less steps back exactly one page,
                // diverging from the built-in's collapse-all-the-way-out; the
                // controls vanish at page 1 / when everything already shows,
                // and a group of <=5 rows never renders this row at all. It
                // lives INSIDE the list as one more item - same indent, same
                // hover shape - and the directional chevrons carry the state
                // beyond color (and give the tap target a reason to exist).
                <SidebarMenuItem data-testid={"session-pager-" + group.key}>
                  <div className="flex items-center gap-1">
                    {paged.page > 1 && (
                      <button
                        type="button"
                        onClick={() => onPageChange(Math.max(1, paged.page - 1))}
                        className={PAGER_BUTTON_CLASS}
                      >
                        <RiArrowUpSLine aria-hidden="true" className={PAGER_ICON_CLASS} />
                        <span>Show less</span>
                      </button>
                    )}
                    {paged.moreCount > 0 && (
                      <button
                        type="button"
                        onClick={() => onPageChange(paged.page + 1)}
                        className={PAGER_BUTTON_CLASS}
                      >
                        <RiArrowDownSLine aria-hidden="true" className={PAGER_ICON_CLASS} />
                        <span>{`Show ${paged.moreCount} more`}</span>
                      </button>
                    )}
                  </div>
                </SidebarMenuItem>
              )}
          </SidebarMenu>
        </>
      )}
    </div>
  );
}

/** The session id a pathname points at, or undefined off a session page. */
function sessionIdFromPathname(pathname: string): string | undefined {
  const prefix = "/sessions/";
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) || undefined : undefined;
}

/**
 * The hydration seed (AC 4 + AC 6): the page holding the active session is
 * computed before first paint, so a deep link server-renders the right page
 * instead of patching it in after hydration. Everything else starts unfolded
 * at page 1 - fold/page state is never persisted, and a full reload re-seeds
 * from the URL and nothing else (AC 5).
 */
function activeSeedPages(
  groups: SessionGroup[],
  activeId: string | undefined,
): Record<string, number> {
  if (activeId === undefined) return {};
  for (const g of groups) {
    if (g.label === undefined) continue; // the flat view is not paged (non-goal)
    const page = sessionPageOf(g.rows, activeId);
    if (page !== undefined) return page > 1 ? { [g.key]: page } : {};
  }
  return {};
}

/**
 * The whole nav section. Props arrive pre-parsed from the prefs channel,
 * so state can trust them as the hydration seed; the flat default lives in
 * lib/session-view (DEFAULT_GROUP).
 */
export function SessionsNav({
  sessions,
  sessionGroup,
}: {
  sessions: SessionsResult;
  sessionGroup: SessionGroupMode | undefined;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [group, setGroup] = useState<SessionGroupMode>(sessionGroup ?? DEFAULT_GROUP);

  // Live title overrides published by an open chat page's downlink (AC 11,
  // commit 6): the request-time rows are the baseline, the store only
  // replaces title cells - a nav refresh re-baselines from session.list.
  // The version snapshot changes ONLY on a publish (server snapshot: no
  // browser store, so SSR renders the request-time rows untouched).
  const navVersion = useSyncExternalStore(subscribeNavLive, navSnapshot, () => 0);

  const groups = useMemo(() => {
    if (sessions.status !== "ok") return [];
    void navVersion; // recompute when a live title lands
    const rows = sessions.sessions.map((session) => {
      const override = navTitleOf(session.id);
      return override === undefined ? session : { ...session, title: override };
    });
    return arrangeSessions(rows, group);
  }, [sessions, group, navVersion]);

  // Fold and page state, keyed by the group key (the cwd string), not the
  // index: groups reorder as activity arrives and index-keyed state would
  // misattribute pages (AC 5). Ephemeral component state - it survives
  // client-side navigation, resets on a full reload, and never reaches the
  // prefs cookie. The Ungrouped bucket shares key "" with the flat view;
  // the label check below makes that collision inert (the flat view has no
  // controls to key).
  const [foldedKeys, setFoldedKeys] = useState<Record<string, boolean>>({});
  const activeId = sessionIdFromPathname(pathname);
  const [pages, setPages] = useState<Record<string, number>>(() =>
    activeSeedPages(groups, activeId),
  );

  const setPage = (key: string, page: number): void =>
    setPages((m) => (m[key] === page ? m : { ...m, [key]: page }));
  const toggleFold = (key: string): void => {
    setFoldedKeys((m) => ({ ...m, [key]: !m[key] }));
    // Reopening returns to page 1 (AC 3); resetting on the way out is the
    // same observable state (a folded group shows no window).
    setPages((m) => (m[key] === undefined || m[key] === 1 ? m : { ...m, [key]: 1 }));
  };

  // Active-session reveal (AC 4), once per active-session change: unfold
  // the holding group and jump to its page. A later manual page move is
  // never yanked back.
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  useEffect(() => {
    if (activeId === undefined) return;
    for (const g of groupsRef.current) {
      if (g.label === undefined) continue;
      const page = sessionPageOf(g.rows, activeId);
      if (page === undefined) continue;
      setFoldedKeys((m) => (m[g.key] ? { ...m, [g.key]: false } : m));
      setPages((m) => (m[g.key] === page ? m : { ...m, [g.key]: page }));
      break;
    }
  }, [activeId]);

  // The scroll half of the reveal, after the jump's re-render: the row only
  // exists once its page is painted, so this retries each commit until it
  // appears - then block "nearest" is the "skip when already in view" rule
  // for free (it scrolls nothing when the element is fully visible).
  const scrolledFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (activeId === undefined || scrolledFor.current === activeId) return;
    const row = document.querySelector('[data-session-id="' + activeId + '"]');
    if (row === null) return;
    scrolledFor.current = activeId;
    row.scrollIntoView({ block: "nearest" });
  }, [activeId, groups, foldedKeys, pages]);

  if (sessions.status === "unavailable") {
    return (
      <SidebarGroup data-testid="sessions-unavailable">
        <SidebarGroupLabel>Sessions</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem className="flex h-8 w-full items-center gap-2 px-2 text-xs">
            {/* The destructive tone is scoped to the status content; the
                outline button keeps its neutral foreground. */}
            <RiCloudOffLine aria-hidden="true" className="size-4 shrink-0 text-destructive/80" />
            <span className="min-w-0 flex-1 truncate text-destructive/80">
              Sessions unavailable
            </span>
            <Button
              variant="outline"
              size="xs"
              aria-label="Retry loading sessions"
              onClick={() => router.refresh()}
            >
              Retry
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    );
  }
  const navigate = (): void => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarGroup data-testid="sessions-nav">
      <SidebarGroupLabel className="flex items-center justify-between gap-1 pr-1">
        <span>Sessions</span>
        {/* The one header control (revised AC): a radio pick-list that
            writes straight through to the prefs cookie. */}
        <span className="flex items-center gap-0.5">
          <HeaderPicker
            label="Session grouping"
            icon={<RiFolderLine className="size-3.5" />}
            value={group}
            options={[
              { value: "workspace", label: "By workspace" },
              { value: "none", label: "No grouping" },
            ]}
            onChange={(next) => {
              const mode = next as SessionGroupMode;
              setGroup(mode);
              void updatePreferences({ sessionGroup: mode });
            }}
          />
        </span>
      </SidebarGroupLabel>
      {groups.map((g) => {
        const pagedGroup = g.label !== undefined;
        return (
          <RowGroup
            key={g.key}
            group={g}
            folded={pagedGroup && foldedKeys[g.key] === true}
            page={pages[g.key] ?? 1}
            activePathname={pathname}
            onNavigate={navigate}
            onFoldToggle={() => toggleFold(g.key)}
            onPageChange={(page) => setPage(g.key, page)}
          />
        );
      })}
    </SidebarGroup>
  );
}
