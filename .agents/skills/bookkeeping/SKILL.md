---
name: bookkeeping
description: Finish work after merge - close completed parent issues and keep task checklists truthful - and sweep drift on demand. Invoked by command only.
disable-model-invocation: true
---

# Bookkeeping after merge

You are loaded when the user types `/bookkeeping`, optionally followed by a starting point - a PR number or URL, a commit hash, or a branch name. Bookkeeping repairs the records - the GitHub issues - to match what has actually happened; it never changes code or plan content. The other skills never edit issues post-merge; this skill owns that tail.

## 1. Resolve the starting point
- The argument names a starting point - a PR (number or URL), a commit hash, or a branch name. Resolve it to a git hash: a merged PR's merge commit, an open PR's head, a branch's tip, a commit as given. Check out that state following the environment's checkout conventions, then run the full check there.
- No argument, or the argument does not resolve: propose running the check on `main` and wait for confirmation - never silently default.
- After checkout, compare the state with the repository's latest. If it is stale (behind latest `main`) or conflicting (diverged from it), notify the user and ask how to proceed: **update first** - bring the starting point up to date (pull, merge, or re-run on latest `main`) - or **proceed with latest info** - records are read from latest `main`, and the starting point only anchors where the tail starts.
- The check always covers the whole repo, never only the starting point's chain. Never mix states silently: the records side of the check comes from exactly one state, chosen explicitly above.

## 2. Gather state
Read the GitHub issues live (open parents and their checklists, task issues and their PR links) at the chosen state - always across the whole repo, never only the starting point. Build the drift list - every place a record disagrees with a fact:
- A task issue not closed by its PR's closing syntax.
- A parent checklist line disagreeing with its issue's actual state; a parent whose sub-issues are all complete but which is still open.

## 3. Preview every repair
Show one itemized list of the intended repairs - for each: what changes, where (issue), and which fact drives it. Nothing is written yet. Drop any repair you cannot ground in a fact; never invent one.

## 4. Apply on one go-ahead
Wait for a single explicit go-ahead for the batch, then apply every repair:
- Close parent issues whose checklists are complete (GitHub closes task issues automatically via PR closing syntax; parents need explicit closing).
- Tick or untick parent checklist lines to match their issues' actual state.
All edits go through the platform directly; the repo holds no per-story records to commit.

## 5. Report
List what was applied, what was skipped and why, and any drift that needs a human decision.
