---
name: bookkeeping
description: Finish work after merge - close completed parent issues, keep task checklists truthful, perform the story-record Done step - and sweep drift on demand. Invoked by command only.
disable-model-invocation: true
---

# Bookkeeping after merge

You are loaded when the user types `/bookkeeping`, optionally followed by a starting point - a PR number or URL, a commit hash, or a branch name. Bookkeeping repairs the repo's records to match what has actually happened; it never changes code or plan content. The other skills never edit records post-merge - this skill owns that tail.

## 1. Resolve the starting point
- The argument names a starting point - a PR (number or URL), a commit hash, or a branch name. Resolve it to a git hash: a merged PR's merge commit, an open PR's head, a branch's tip, a commit as given. Check out that state following the environment's checkout conventions, then run the full check there.
- No argument, or the argument does not resolve: propose running the check on `main` and wait for confirmation - never silently default.
- The check always covers the whole repo, never only the starting point's chain. When the checked-out state is not current `main`, say so in the preview and mark the repairs that depend on it - they may need a re-run once that state merges.

## 2. Gather state
Read the GitHub issues (open parents and their checklists, task issues and their PR links) live, and the story records under `docs/stories/` with the index `docs/stories/README.md` at the checked-out state - always across the whole repo, never only the starting point. Build the drift list - every place a record disagrees with a fact:
- A task issue not closed by its PR's closing syntax.
- A parent checklist line disagreeing with its issue's actual state; a parent whose sub-issues are all complete but which is still open.
- A complete story whose record lacks its `- PR:` line, or whose index entry is not struck.

## 3. Preview every repair
Show one itemized list of the intended repairs - for each: what changes, where (issue / record / index), and which fact drives it. Nothing is written yet. Drop any repair you cannot ground in a fact; never invent one.

## 4. Apply on one go-ahead
Wait for a single explicit go-ahead for the batch, then apply every repair:
- Close parent issues whose checklists are complete (GitHub closes task issues automatically via PR closing syntax; parents need explicit closing).
- Tick or untick parent checklist lines to match their issues' actual state.
- Perform the story-record Done step: add `- PR: <merged PR URL>` to the record header and strike the index entry in `docs/stories/README.md`.
Commit record edits on a branch following the environment's conventions; never push to `main` directly. Issue edits (closing, checklist ticks) go through the platform directly.

## 5. Report
List what was applied, what was skipped and why, and any drift that needs a human decision.
