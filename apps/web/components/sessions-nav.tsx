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
 * rows (AC 6). Sorting offers recency and title; manual reorder was
 * dropped from this scope before review.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { RiCloudOffLine, RiFolderLine, RiSortDesc } from "@remixicon/react";
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
import { updatePreferences, type SessionViewPreferences } from "../lib/preferences";
import type { SessionsResult } from "../lib/sessions";
import {
  DEFAULT_SESSION_VIEW,
  arrangeSessions,
  formatRelativeTime,
  type SessionGroup,
  type SessionGroupMode,
  type SessionRow,
  type SessionSortMode,
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
          "size-1.5 shrink-0 rounded-full " +
          (running ? "bg-emerald-500" : "bg-muted-foreground/30")
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
        className="ml-auto shrink-0 text-[10px] tabular-nums text-sidebar-foreground/50"
      >
        {formatRelativeTime(session.updatedAt)}
      </time>
    </SidebarMenuButton>
  );
}

/** One arranged group: optional workspace header, parents then nested children. */
function RowGroup({
  group,
  activePathname,
  onNavigate,
}: {
  group: SessionGroup;
  activePathname: string;
  onNavigate: () => void;
}) {
  return (
    <div data-testid={"session-group-" + group.key}>
      {group.label !== undefined && (
        <div
          className="flex items-center gap-1 px-2 pt-2 pb-1 text-[11px] font-medium text-sidebar-foreground/50"
          title={group.detail}
        >
          <RiFolderLine aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{group.label}</span>
        </div>
      )}
      <SidebarMenu>
        {group.rows.map((row) => (
          <SidebarMenuItem key={row.session.id} data-session-id={row.session.id}>
            <RowButton
              row={row}
              active={activePathname === "/sessions/" + row.session.id}
              onNavigate={onNavigate}
            />
            {row.children.length > 0 && (
              <ul className="ml-5 border-l border-sidebar-border pl-1">
                {row.children.map((child) => (
                  <li key={child.id} data-session-id={child.id}>
                    <RowButton
                      row={{ session: child, children: [] }}
                      active={activePathname === "/sessions/" + child.id}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            )}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </div>
  );
}

/**
 * The whole nav section. Props arrive pre-parsed from the prefs channel,
 * so state can trust them as the hydration seed; the resolved defaults
 * live in lib/session-view (DEFAULT_SESSION_VIEW).
 */
export function SessionsNav({
  sessions,
  view,
}: {
  sessions: SessionsResult;
  view: SessionViewPreferences;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [group, setGroup] = useState<SessionGroupMode>(view.group ?? DEFAULT_SESSION_VIEW.group);
  const [sort, setSort] = useState<SessionSortMode>(view.sort ?? DEFAULT_SESSION_VIEW.sort);

  const persistView = (next: { group?: SessionGroupMode; sort?: SessionSortMode }) => {
    // Persist the full pair so one control change never blanks the other.
    void updatePreferences({
      sessions: {
        group: next.group ?? group,
        sort: next.sort ?? sort,
      },
    });
  };

  const groups = useMemo(() => {
    if (sessions.status !== "ok") return [];
    return arrangeSessions(sessions.sessions, { group, sort });
  }, [sessions, group, sort]);

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
        {/* Controls sit in the sessions header (AC 3/4): grouping left of
            sorting, each a radio pick-list writing straight to the prefs. */}
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
              persistView({ group: mode });
            }}
          />
          <HeaderPicker
            label="Session sorting"
            icon={<RiSortDesc className="size-3.5" />}
            value={sort}
            options={[
              { value: "recency", label: "Recency" },
              { value: "title", label: "Title A-Z" },
            ]}
            onChange={(next) => {
              const mode = next as SessionSortMode;
              setSort(mode);
              persistView({ sort: mode });
            }}
          />
        </span>
      </SidebarGroupLabel>
      {groups.map((g) => (
        <RowGroup key={g.key} group={g} activePathname={pathname} onNavigate={navigate} />
      ))}
    </SidebarGroup>
  );
}
