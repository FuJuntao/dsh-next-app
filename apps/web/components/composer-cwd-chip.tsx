"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DirectoryListing } from "@deepseek-ai/dsh-host-apiproxy/api";
import { RiArrowRightSLine, RiFolder5Line } from "@remixicon/react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

/** Last path segment for the chip label ("/" stays "/", "/a/b/" -> "b"). */
function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  if (trimmed === "") return "/";
  const base = trimmed.split("/").pop();
  return base ?? trimmed;
}

/**
 * The in-app directory browser (story #117 task #122, restricted per
 * review): the `browseDirectory` action confines browsing to the host's
 * DEFAULT WORKING FOLDER - only its subfolders are listable and only
 * subfolders are choosable. The server enforces the containment and
 * trims the crumb chain to the subtree, so the rail's first crumb IS the
 * default folder and the UI has no escape hatch to render (a raw path
 * outside the subtree is refused in the action regardless). At the
 * default folder itself the Choose button is absent: naming no folder
 * already means it - a choice is a subfolder. Hidden entries (host flags
 * them by platform convention; the client owns the display choice) stay
 * out of the list. A browse failure renders inline and keeps the last
 * listing on screen.
 */
function DirectoryBrowser({ onPick }: { onPick: (path: string) => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [atRoot, setAtRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stale-response guard: fast drill clicks must not land out of order.
  const seqRef = useRef(0);

  const browse = useCallback((path?: string) => {
    const seq = ++seqRef.current;
    void browseDirectory(path).then((result) => {
      if (seq !== seqRef.current) return;
      if (result.ok) {
        setListing(result.listing);
        setAtRoot(result.atRoot);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, []);

  useEffect(() => {
    browse();
  }, [browse]);

  const visible = listing?.entries.filter((entry) => !entry.hidden) ?? [];

  return (
    <div className="flex flex-col gap-2">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {listing === null && error === null ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-5 w-full" />
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : (
        listing !== null && (
          <>
            <nav aria-label="Folders" className="flex items-center gap-1 overflow-x-auto text-xs">
              {listing.crumbs.map((crumb, index) => (
                <span key={crumb.path} className="flex shrink-0 items-center gap-1">
                  {index > 0 && (
                    <RiArrowRightSLine className="size-3.5 shrink-0 text-muted-foreground/60" />
                  )}
                  {crumb.path === listing.path ? (
                    <span className="px-1 py-0.5 font-medium" aria-current="location">
                      {crumb.name}
                      {index === 0 ? " (default)" : ""}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => browse(crumb.path)}
                      className="rounded-sm px-1 py-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
                    >
                      {crumb.name}
                      {index === 0 ? " (default)" : ""}
                    </button>
                  )}
                </span>
              ))}
            </nav>
            <ul className="max-h-64 overflow-y-auto border border-input">
              {visible.length === 0 && (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  No visible subfolders.
                </li>
              )}
              {visible.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    onClick={() => browse(entry.path)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <RiFolder5Line className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground" title={listing.path}>
                {listing.path}
                {listing.truncated ? " (partial list)" : ""}
              </p>
              {atRoot ? (
                // The default folder itself is not a choice - naming no
                // folder already means it. A choice is a subfolder.
                <span className="shrink-0 text-xs text-muted-foreground">
                  Open a subfolder to choose it
                </span>
              ) : (
                <Button type="button" size="xs" onClick={() => onPick(listing.path)}>
                  Choose
                </Button>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}

/**
 * The cwd picker chip: label is the chosen folder's name (the full path
 * rides in the title), and the dialog above does the browsing. Null means
 * no selection - `session.create` omits cwd and the host default applies.
 */
export function ComposerCwdChip({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Working folder"
        title={value ?? "Working folder: host default"}
        className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground"
      >
        <RiFolder5Line className="size-3.5 shrink-0" />
        <span className="max-w-32 truncate">{value === null ? "Folder" : folderName(value)}</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a folder</DialogTitle>
          <DialogDescription>
            The new session&apos;s working directory - a subfolder of the host&apos;s default
            working folder.
          </DialogDescription>
        </DialogHeader>
        <DirectoryBrowser
          onPick={(path) => {
            onChange(path);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
