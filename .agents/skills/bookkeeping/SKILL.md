---
name: bookkeeping
description: Finish work after merge - close completed parent issues, keep task checklists truthful, perform the story-record Done step - and sweep drift on demand. Invoked by command only.
disable-model-invocation: true
---

# Bookkeeping after merge

You are loaded when the user types `/bookkeeping`, optionally followed by a merged PR number or URL. Bookkeeping repairs the repo's records to match what has actually happened; it never changes code or plan content. The other skills never edit records post-merge - this skill owns that tail.

## 1. Pick the mode
- With a merged-PR argument: **post-merge mode** - the tail of that one PR.
- Without an argument: **drift sweep** - scan the repo's records for lag with reality.
- With an open (unmerged) PR: say so and stop; post-merge bookkeeping waits for the merge.

## 2. Gather state
Read the GitHub issues (open parents and their checklists, task issues and their PR links), the story records under `docs/stories/` with the index `docs/stories/README.md`, and the merged PRs involved. Build the drift list - every place a record disagrees with a fact:
- Post-merge mode: the PR's task issue (closed via the PR's closing syntax? close it if not), the parent's checklist line (ticked to match?), the parent itself (all items complete -> close it), and the story record (all tasks done -> Done step).
- Sweep mode, additionally: any open parent whose sub-issues are all complete; any complete story whose record lacks its `- PR:` line; any done story whose index entry is not struck; any checklist line disagreeing with its issue's actual state.

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
