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
Before reviewing, read: the PR (diff, body, commits, status checks), the task issue and parent issue it closes (including the AC checkpoint and story-record link), the linked story record under `docs/stories/`, ADRs relevant to the change, and whatever contributor conventions (AGENTS.md or equivalent) apply in the environment this runs in. Never invent constraints the context does not contain.

## 3. Review along the axes
Run every axis whose applicability rule matches; the verdict states which axes ran and which were skipped as not applicable. When the PR is too complicated to review alone, fan the axes out to additional agents where the environment provides them - one per axis - and assemble their findings into the single verdict of step 4.
- **Spec** (always): the diff satisfies the task's AC checkpoint and the linked story record. Blockers trace to the AC or the record.
- **System design** (always): repo-wide constraints - ADR compliance, workspace boundaries, API shape. Blockers trace to the ADR or constraint violated; a PR that satisfies its task yet violates an ADR fails here.
- **Repo standards** (always): the change meets the repo's stated standards beyond the ADRs - its contributor doc (AGENTS.md or equivalent), the README's user-facing commitments, and any other convention the repo states. Blockers trace to the statement violated.
- **UI** (only when the diff touches UI code): exercise the built app with the `agent-browser` skill against the PR's changes; if the app cannot be built or run in this environment, say plainly that the UI axis was reviewed statically only.
- **Security** (always): no secrets or leaked personal data; public-repo hygiene per ADR-0005.
- **Docs discipline** (always): doc changes ship together with the implying change, ADRs stay frozen, task lists stay truthful (ADR-0005); volatile state is referred to its source of truth - a doc that restates what a lock file, directory, or tracker already tracks is a blocker.
- **Verification claims** (always): the PR body states what was run - re-run it or check its plausibility. A missing claim is a blocker (the `implement-a-task` contract requires one); a claim that does not reproduce is a blocker.
- **Commit hygiene** (always): the commit conventions stated by the environment this runs in.
The axes are floors: judgment may raise anything they do not cover.
As each finding is gathered, record its anchor data: the file path and line - or start-end line range - within the PR diff, and the HEAD commit SHA reviewed. A finding that refers to repo state rather than a location in the diff - a process or repo-wide finding - is recorded as unanchorable.

## 4. Deliver the verdict
- **Approve**: summarize the findings per axis that ran, then proceed to step 5.
- **Request changes**: numbered blockers, each tagged with its axis and traceable to its source (task AC, ADR, convention). Separate blocking from non-blocking plainly - no rubber stamp, no style noise. The skill ends here; re-review after fixes is a new invocation.
- Post the verdict on the PR via the platform as one plain-comment review anchored at the HEAD commit reviewed:
  - Summary body: the outcome, which axes ran and which were skipped, and every unanchorable finding.
  - One inline review comment per anchorable finding - blockers and non-blocking observations alike - anchored at the file path and line, or start-end line range when the finding spans lines.
  - All findings share one continuous numbering across the summary body and the inline comments; every posted finding keeps its axis tag and traceability to its source. The posted content is the complete verdict.
  - Post no formal approve/request-changes state - the review is a comment, so it never blocks the merge on its own.
- Chat carries a minimal summary: the outcome, the finding counts, and a link to the posted review. A finding that fails to post keeps its number and stays in chat in full - findings are never silently lost.
- When posting is unavailable - no platform tooling or no auth - say so plainly and leave the complete verdict in chat instead.
- On a re-review, also inspect the open review-comment threads that earlier passes of this skill created, recognized by the posting account and the skill's comment format: mark a thread resolved only when this pass verifies its anchored finding no longer holds. Never touch threads created by humans; never edit or delete earlier reviews - each pass posts a fresh review.

## 5. Merge gate
After an approve verdict, wait for an explicit merge go-ahead. On approval, merge the PR via the platform - never push to `main` directly - then point the user to `/bookkeeping` for the post-merge tail. The gate fires per PR.
