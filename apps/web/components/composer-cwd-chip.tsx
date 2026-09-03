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
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [children, setChildren] = useState<Record<string, ChildrenState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Stale-response guard per node: fast expand clicks must not land out of order.
  const seqRef = useRef<Record<string, number>>({});

  const visible = (entries: { name: string; path: string; hidden: boolean }[]): TreeNode[] =>
    entries.filter((entry) => !entry.hidden).map((entry) => ({ name: entry.name, path: entry.path }));

  const load = useCallback((path: string) => {
    const seq = (seqRef.current[path] ?? 0) + 1;
    seqRef.current[path] = seq;
    setChildren((prev) => ({ ...prev, [path]: { loading: true } }));
    void browseDirectory(path).then((result) => {
      if (seqRef.current[path] !== seq) return;
      if (result.ok) {
        setChildren((prev) => ({
          ...prev,
          [path]: {
            loading: false,
            entries: result.listing.entries
              .filter((entry) => !entry.hidden)
              .map((entry) => ({ name: entry.name, path: entry.path })),
            truncated: result.listing.truncated,
          },
        }));
      } else {
        setChildren((prev) => ({ ...prev, [path]: { loading: false, error: result.error } }));
      }
    });
  }, []);

  // The root listing seeds the tree (and arrives expanded - its children
  // ARE the list the picker used to show).
  useEffect(() => {
    void browseDirectory().then((result) => {
      if (!result.ok) {
        setRootError(result.error);
        return;
      }
      const first = result.listing.crumbs[0];
      const rootNode: TreeNode = {
        name: first?.name ?? folderName(result.listing.path),
        path: result.listing.path,
      };
      setRoot(rootNode);
      setChildren({
        [rootNode.path]: {
          loading: false,
          entries: visible(result.listing.entries),
          truncated: result.listing.truncated,
        },
      });
      setExpanded({ [rootNode.path]: true });
    });
    // One seed per mount; the dialog remounts this tree when it opens.
  }, []);

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
            {state === undefined || state.loading ? (
              // Skeleton rows, not a "Loading…" label - the same loading
              // language as the seed, so an expansion previews its rows.
              <div className="flex flex-col gap-1.5 py-1" style={{ paddingLeft: (depth + 1) * INDENT }}>
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-4 w-32" />
                ))}
              </div>
            ) : state.error !== undefined ? (
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
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-full" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
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
