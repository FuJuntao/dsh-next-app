---
name: review
description: Review an open pull request along explicit axes - spec, system design, repo standards, UI, security, docs discipline, verification claims, commit hygiene - post the verdict on the PR as anchored review comments, and gate the merge. Invoked by command only.
disable-model-invocation: true
---

# Review a pull request

You are loaded when the user types `/review`, optionally followed by a PR number or URL (e.g. `/review 21`). Review exactly one PR per invocation. The skill ends at the merge gate. Never push to `main`.

## 1. Pick the PR
- With an argument: resolve it to exactly one open PR; if it does not resolve, say so and stop.
- Without: list open PRs and let the user pick.
- Confirm with the user before reviewing a draft or empty PR.

## 2. Gather context
Before reviewing, read: the PR (diff, body, commits, status checks), the task issue and parent issue it closes (including the AC checkpoint; the story's content lives in the parent issue body), ADRs relevant to the change, and whatever contributor conventions (AGENTS.md or equivalent) apply in the environment this runs in. Never invent constraints the context does not contain.

## 3. Review along the axes
Run every axis whose applicability rule matches; the verdict states which axes ran and which were skipped as not applicable. When the PR is too complicated to review alone, fan the axes out to additional agents where the environment provides them - one per axis - and assemble their findings into the single verdict of step 4.
- **Spec** (always): the diff satisfies the task's AC checkpoint and the story's acceptance criteria as carried in the parent issue. Blockers trace to the AC or the story.
- **System design** (always): repo-wide constraints - ADR compliance, workspace boundaries, API shape. Blockers trace to the ADR or constraint violated; a PR that satisfies its task yet violates an ADR fails here.
- **Repo standards** (always): the change meets the repo's stated standards beyond the ADRs - its contributor doc (AGENTS.md or equivalent), the README's user-facing commitments, and any other convention the repo states. Blockers trace to the statement violated.
- **UI** (only when the diff touches UI code): the parent issue's `## Design` packet - written by the `design` skill - carries this axis's criteria; blockers trace to it or, when the story predates the packet, to the acceptance criteria. A UI-touching diff whose parent has no packet is itself a finding. Exercise the built app with the `agent-browser` skill against the PR's changes and the packet's states; if the app cannot be built or run in this environment, say plainly that the UI axis was reviewed statically only.
- **Security** (always): no secrets or leaked personal data; public-repo hygiene per ADR-0004.
- **Docs discipline** (always): doc changes ship together with the implying change, ADRs stay frozen, task lists stay truthful (ADR-0004); volatile state is referred to its source of truth - a doc that restates what a lock file, directory, or tracker already tracks is a blocker.
- **Verification claims** (always): the PR body states what was run - re-run it or check its plausibility. A missing claim is a blocker (the `implement-a-task` contract requires one); a claim that does not reproduce is a blocker.
- **Commit hygiene** (always): the commit conventions stated by the environment this runs in.
The axes are floors: judgment may raise anything they do not cover.
As each finding is gathered, record its anchor data: the file path and line - or start-end line range - within the PR diff, and the HEAD commit SHA reviewed. A finding that refers to repo state rather than a location in the diff - a process or repo-wide finding - is recorded as unanchorable.

## 4. Deliver the verdict
- **Approve**: the summary body is the verdict - outcome line, axes ran/skipped, then one compact line per axis that ran. Then proceed to step 5.
- **Request changes**: numbered findings, each tagged with its axis and traceable to its source (task AC, ADR, convention). Separate blocking from non-blocking plainly - no rubber stamp, no style noise. The skill ends here; re-review after fixes is a new invocation.
- Post the verdict on the PR via the platform as one plain-comment review anchored at the HEAD commit reviewed:
  - Summary body, in this order and nothing else: the outcome line, one line of axes ran and one of axes skipped, and every unanchorable finding in full. Anchorable findings are the inline threads - the summary never re-lists them and may at most point at them with one line ("findings #1-#2 are posted inline at their lines").
    - On **Approve**, one compact line per axis that ran carries the verdict, with any unanchorable findings after them. On **Request changes**, there is no per-axis rollup - an axis without a finding has passed, and silence says so.
    - Verdict content only: no merge dry runs, no re-run or build logs, and no process notes the PR cannot act on (such as where its branch was created or worktree-convention slips) - those go in chat, not the PR.
  - One inline review comment per anchorable finding - blockers and non-blocking observations alike - anchored at the file path and line, or start-end line range when the finding spans lines.
  - Findings share one continuous numbering across the posted content; every posted finding keeps its axis tag and traceability to its source. The posted content - summary plus threads - is the complete verdict.
  - Every posted finding opens with a marker line of the form `[review] <axis> #<number>` - the format later passes use to recognize this skill's own threads.
  - Post no formal approve/request-changes state - the review is a comment, so it never blocks the merge on its own.
  - Request changes body shape, nothing after the unanchorable findings:

    ```
    **Request changes — 1 blocker, 2 non-blocking — reviewed at `<sha>`**
    Axes ran: <axes>
    Axes skipped: <axes> (<reason>)
    Findings #1-#2 are posted inline at their lines.

    <unanchorable finding #3 in full - the only finding text in the summary>
    ```
- Chat carries a minimal summary: the outcome, the finding counts, a link to the posted review, plus whatever the posted verdict must leave out - reviewer-internal verification detail (dry runs, re-runs, build notes) and process notes the PR cannot act on. Chat-only notes never get a finding number. A finding that fails to post keeps its number and stays in chat in full - findings are never silently lost.
- When posting is unavailable - no platform tooling or no auth - say so plainly and leave the complete verdict in chat instead.
- On a re-review, also inspect the open review-comment threads that earlier passes of this skill created, recognized by the posting account and the marker format above: mark a thread resolved only when this pass verifies its anchored finding no longer holds. Never touch threads created by humans; never edit or delete earlier reviews - each pass posts a fresh review.

## 5. Merge gate
After an approve verdict, wait for an explicit merge go-ahead. On approval, merge the PR via the platform - never push to `main` directly - then point the user to `/bookkeeping` for the post-merge tail. The gate fires per PR.
