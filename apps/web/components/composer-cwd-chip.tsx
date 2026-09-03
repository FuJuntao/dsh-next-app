"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiFolder5Line,
} from "@remixicon/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { browseDirectory } from "@/lib/host-browse";
import { cn } from "@/lib/utils";

/** Last path segment for the chip label ("/" stays "/", "/a/b/" -> "b"). */
function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  if (trimmed === "") return "/";
  const base = trimmed.split("/").pop();
  return base ?? trimmed;
}

/** One folder node of the tree (name + absolute path). */
interface TreeNode {
  name: string;
  path: string;
}

/** The lazy child-state of one node, keyed by its path. */
interface ChildrenState {
  loading: boolean;
  entries?: TreeNode[];
  /** The host capped the listing; say so rather than lie about the set. */
  truncated?: boolean;
  error?: string;
}

/** Per-depth indentation in px (deep names wrap; the tree does not scroll sideways). */
const INDENT = 16;

/** How long a load must outlive before its skeleton is mounted at all. */
const SKELETON_DELAY_MS = 250;

/** True `ms` after mount; the timer is the whole component's state. */
function useDelayedTrue(ms: number): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return show;
}

/**
 * Skeleton rows that MOUNT only once the pending load has outlived the
 * delay - a fast listing never reserves a single pixel. (A CSS
 * display-animation hold was tried first and is a browser-feature bet:
 * where `display` is not animatable it degrades to an invisible-but-
 * laid-out box, which is the exact dialog jump this exists to prevent.)
 */
function SkeletonRows({ rows, indent }: { rows: string[]; indent: number }): ReactElement | null {
  const show = useDelayedTrue(SKELETON_DELAY_MS);
  if (!show) return null;
  return (
    <div className="flex flex-col gap-1.5 py-1" style={{ paddingLeft: indent }}>
      {rows.map((row, index) => (
        <Skeleton key={index} className={row} />
      ))}
    </div>
  );
}

/** The tree's cached seed: the root listing plus the session's browsing. */
interface TreeSeed {
  root: TreeNode;
  children: Record<string, ChildrenState>;
  expanded: Record<string, boolean>;
}

type SeedResult = { seed: TreeSeed } | { error: string };

// The seed lives at module scope (one cwd chip per page, one deployment
// per tab): the chip warms it on mount so the FIRST dialog open usually
// renders the tree instead of flashing the seed skeleton, and the tree
// writes its state back so a REOPEN shows the cached listing instantly
// and refreshes it in the background (stale-while-revalidate).
let seedCache: TreeSeed | null = null;
let seedPromise: Promise<SeedResult> | null = null;

const visibleEntries = (
  entries: { name: string; path: string; hidden: boolean }[],
): TreeNode[] =>
  entries
    .filter((entry) => !entry.hidden)
    .map((entry) => ({ name: entry.name, path: entry.path }));

/** The root listing, deduplicated across the prefetch and the tree mount. */
function getSeed(): Promise<SeedResult> {
  if (seedCache !== null) return Promise.resolve({ seed: seedCache });
  if (seedPromise === null) {
    seedPromise = browseDirectory()
      .then((result): SeedResult => {
        if (!result.ok) return { error: result.error };
        const first = result.listing.crumbs[0];
        const root: TreeNode = {
          name: first?.name ?? folderName(result.listing.path),
          path: result.listing.path,
        };
        const seed: TreeSeed = {
          root,
          children: {
            [root.path]: {
              loading: false,
              entries: visibleEntries(result.listing.entries),
              truncated: result.listing.truncated,
            },
          },
          expanded: { [root.path]: true },
        };
        seedCache = seed;
        return { seed };
      })
      .catch((cause: unknown): SeedResult => ({
        error: cause instanceof Error ? cause.message : String(cause),
      }))
        .finally(() => {
          // A failed seed must not poison the next attempt; a resolved one
          // is already in seedCache.
          seedPromise = null;
        });
  }
  return seedPromise;
}

/**
 * The in-app folder TREE (story #117 task #122, restricted per review;
 * tree view per layout round): the default working folder is the root and
 * each node lazily loads its children through the `browseDirectory`
 * action - one call per expansion, containment enforced server-side (only
 * the default folder's subtree is listable, and the default folder itself
 * is the only path that may be chosen while AT the root). Tapping a row
 * CHOOSES that folder and closes the dialog, so the old crumb rail and
 * the bottom path line - one long unbreakable token that kept overflowing
 * the phone - are gone; the root row carries the "(default)" marker the
 * old "Choose default" button offered. Hidden entries (host flags them by
 * platform convention; the client owns the display choice) stay out of
 * the tree. Collapsing and re-expanding a failed node retries it.
 */
function FolderTree({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (path: string) => void;
}) {
  const [root, setRoot] = useState<TreeNode | null>(seedCache?.root ?? null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [children, setChildren] = useState<Record<string, ChildrenState>>(seedCache?.children ?? {});
  const [expanded, setExpanded] = useState<Record<string, boolean>>(seedCache?.expanded ?? {});
  // Stale-response guard per node: fast expand clicks must not land out of order.
  const seqRef = useRef<Record<string, number>>({});

  const load = useCallback((path: string) => {
    const seq = (seqRef.current[path] ?? 0) + 1;
    seqRef.current[path] = seq;
    // Keep any stale entries on screen while refreshing (the background
    // revalidation must not blank the tree into a skeleton flash).
    setChildren((prev) => ({ ...prev, [path]: { ...prev[path], loading: true } }));
    void browseDirectory(path).then((result) => {
      if (seqRef.current[path] !== seq) return;
      if (result.ok) {
        setChildren((prev) => ({
          ...prev,
          [path]: {
            loading: false,
            entries: visibleEntries(result.listing.entries),
            truncated: result.listing.truncated,
          },
        }));
      } else {
        setChildren((prev) => ({ ...prev, [path]: { ...prev[path], loading: false, error: result.error } }));
      }
    });
  }, []);

  // Hydrate-or-seed: a cached tree shows NOW and revalidates its root
  // listing in the background; a cold tree awaits the (possibly already
  // in-flight from the chip's prefetch) shared seed call.
  useEffect(() => {
    if (seedCache !== null) {
      load(seedCache.root.path);
      return;
    }
    void getSeed().then((result) => {
      if ("error" in result) {
        setRootError(result.error);
        return;
      }
      setRoot(result.seed.root);
      setChildren(result.seed.children);
      setExpanded(result.seed.expanded);
    });
  }, [load]);

  // Write the live browsing back to the module cache, so a reopen starts
  // from where the user left off (expanded nodes included).
  useEffect(() => {
    if (root !== null) seedCache = { root, children, expanded };
  }, [root, children, expanded]);

  const toggle = (path: string): void => {
    const open = expanded[path] !== true;
    setExpanded((prev) => ({ ...prev, [path]: open }));
    const state = children[path];
    // Load on first open, and retry an errored node on re-open.
    if (open && (state === undefined || state.error !== undefined)) load(path);
  };

  const renderNode = (node: TreeNode, depth: number, isRoot = false): ReactElement => {
    const open = expanded[node.path] === true;
    const state = children[node.path];
    const chosen = value === node.path;
    return (
      <div key={node.path}>
        <div className="flex items-center" style={{ paddingLeft: depth * INDENT }}>
          <button
            type="button"
            onClick={() => toggle(node.path)}
            aria-expanded={open}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
          >
            {open ? (
              <RiArrowDownSLine className="size-3.5" />
            ) : (
              <RiArrowRightSLine className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onPick(node.path)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent",
              chosen && "font-medium",
            )}
          >
            <RiFolder5Line className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-all">
              {node.name}
              {isRoot ? " (default)" : ""}
            </span>
            {chosen && <RiCheckLine className="ml-auto size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        </div>
        {open && (
          <div>
            {state === undefined || (state.entries === undefined && state.loading) ? (
              // Skeleton rows, never a "Loading…" label - mounted only if
              // the load outlives the delay (a fast listing reserves no
              // space), and a refresh that HAS stale entries keeps them
              // on screen instead.
              <SkeletonRows rows={["h-4 w-32", "h-4 w-32", "h-4 w-32"]} indent={(depth + 1) * INDENT} />
            ) : state.entries === undefined && state.error !== undefined ? (
              <p
                className="py-1 text-xs break-all text-destructive"
                style={{ paddingLeft: (depth + 1) * INDENT }}
              >
                {state.error}
              </p>
            ) : (
              <>
                {(state.entries ?? []).map((child) => renderNode(child, depth + 1))}
                {(state.entries ?? []).length === 0 && (
                  <p
                    className="py-1 text-xs text-muted-foreground"
                    style={{ paddingLeft: (depth + 1) * INDENT }}
                  >
                    No subfolders.
                  </p>
                )}
                {state.truncated === true && (
                  <p
                    className="py-1 text-xs text-muted-foreground"
                    style={{ paddingLeft: (depth + 1) * INDENT }}
                  >
                    Some folders are not listed.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (rootError !== null) {
    return (
      <Alert variant="destructive">
        {/* break-all: the error names paths - one unbreakable token
            would overflow a phone-width dialog. */}
        <AlertDescription className="break-all">{rootError}</AlertDescription>
      </Alert>
    );
  }
  if (root === null) {
    return (
      // The chip's prefetch usually wins this race outright; when it
      // doesn't, the skeleton waits out the same delay before taking space.
      <SkeletonRows
        rows={["h-5 w-full", "h-7 w-full", "h-7 w-full", "h-7 w-full", "h-7 w-full", "h-7 w-full"]}
        indent={0}
      />
    );
  }
  return (
    <div className="max-h-72 overflow-y-auto">{renderNode(root, 0, true)}</div>
  );
}

/**
 * The cwd picker chip: label is the chosen folder's name (the full path
 * rides in the title), and the tree dialog above does the browsing. Null
 * means no selection - `session.create` omits cwd and the host default
 * applies.
 */
export function ComposerCwdChip({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Controlled so the locked composer's editor tap can open it too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  // Warm the root listing while the page sits idle: by the time the user
  // taps the chip, the seed is usually in, and the dialog opens straight
  // into the tree - the skeleton only survives a genuinely slow first call.
  useEffect(() => {
    void getSeed();
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Working folder"
        title={value ?? "Working folder: host default"}
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground"
      >
        <RiFolder5Line className="size-3.5 shrink-0" />
        <span className="min-w-0 break-all text-left">
          {value === null ? "Folder" : folderName(value)}
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a folder</DialogTitle>
          <DialogDescription>The new session&apos;s working directory.</DialogDescription>
        </DialogHeader>
        <FolderTree
          value={value}
          onPick={(path) => {
            onChange(path);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
