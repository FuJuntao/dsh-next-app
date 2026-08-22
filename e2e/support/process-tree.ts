import { readdirSync, readFileSync } from "node:fs";

/**
 * POSIX /proc process-tree helpers for the supervision specs. The row's Next
 * child is a direct child of the dsh boot process, leading its own process
 * group (the subprocess service spawns detached), so the restart and
 * teardown assertions reduce to parent/group arithmetic. /proc is
 * Linux-only; the suite's CI target is ubuntu-latest (ADR-0006).
 */

/** Parse the post-comm fields of a /proc/<pid>/stat line. */
function statFields(pid: number): string[] | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The comm field may contain spaces and parens, so fields start after
    // its closing ')': state ppid pgrp session ...
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  } catch {
    return undefined; // the process is gone
  }
}

/** The process's parent pid, or -1 when the process is gone. */
export function processPpid(pid: number): number {
  const fields = statFields(pid);
  return fields === undefined ? -1 : Number(fields[1] ?? -1);
}

/** The process's process-group id, or -1 when the process is gone. */
export function processGroupId(pid: number): number {
  const fields = statFields(pid);
  return fields === undefined ? -1 : Number(fields[2] ?? -1);
}

/** Whether a process is alive (kill(pid, 0) succeeds). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Pids of every live process in the given process group. */
export function processGroupMembers(pgid: number): number[] {
  const members: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (processGroupId(pid) === pgid) members.push(pid);
  }
  return members;
}

/**
 * The unique live child of a process - the row supervises exactly one Next
 * child. undefined when the process has zero or several children, so callers
 * fail loudly instead of guessing.
 */
export function uniqueChildOf(pid: number): number | undefined {
  const children: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const candidate = Number(entry);
    if (processPpid(candidate) === pid) children.push(candidate);
  }
  return children.length === 1 ? children[0] : undefined;
}
