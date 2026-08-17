---
name: review
description: Review an open pull request along explicit axes - spec, system design, UI, security, docs discipline, verification claims, commit hygiene - with a structured verdict and a gated merge. Invoked by command only.
disable-model-invocation: true
---

# Review a pull request

You are loaded when the user types `/review`, optionally followed by a PR number or URL (e.g. `/review 21`). Review exactly one PR per invocation. The skill ends at the merge gate: post-merge closing and story-record bookkeeping belong to the `bookkeeping` skill. Never push to `main`.

## 1. Pick the PR
- With an argument: resolve it to exactly one open PR; if it does not resolve, say so and stop.
- Without: list open PRs and let the user pick.
- Confirm with the user before reviewing a draft or empty PR.

## 2. Gather context
Before reviewing, read: the PR (diff, body, commits, status checks), the task issue and parent issue it closes (including the AC checkpoint and story-record link), the linked story record under `docs/stories/`, ADRs relevant to the change, and whatever contributor conventions (AGENTS.md or equivalent) apply in the environment this runs in. Never invent constraints the context does not contain.

## 3. Review along the axes
Run every axis whose applicability rule matches; the verdict states which axes ran and which were skipped as not applicable.
- **Spec** (always): the diff satisfies the task's AC checkpoint and the linked story record. Blockers trace to the AC or the record.
- **System design** (always): repo-wide constraints - ADR compliance, workspace boundaries, API shape. Blockers trace to the ADR or constraint violated; a PR that satisfies its task yet violates an ADR fails here.
- **UI** (only when the diff touches UI code): exercise the built app with the `agent-browser` skill against the PR's changes; if the app cannot be built or run in this environment, say plainly that the UI axis was reviewed statically only.
- **Security** (always): no secrets or leaked personal data; public-repo hygiene per ADR-0005.
- **Docs discipline** (always): doc changes ship together with the implying change, ADRs stay frozen, task lists stay truthful (ADR-0005).
- **Verification claims** (always): the PR body states what was run - re-run it or check its plausibility. A missing claim is a blocker (the `implement-a-task` contract requires one); a claim that does not reproduce is a blocker.
- **Commit hygiene** (always): the commit conventions stated by the environment this runs in.
The axes are floors: judgment may raise anything they do not cover.

## 4. Deliver the verdict
- **Approve**: summarize the findings per axis that ran, then proceed to step 5.
- **Request changes**: numbered blockers, each tagged with its axis and traceable to its source (task AC, ADR, convention). Separate blocking from non-blocking plainly - no rubber stamp, no style noise. The skill ends here; re-review after fixes is a new invocation.
- The verdict is posted in chat; comment on the PR only if the user asks.

## 5. Merge gate
After an approve verdict, wait for an explicit merge go-ahead. On approval, merge the PR via the platform - never push to `main` directly - then point the user to `/bookkeeping` for the post-merge tail. The gate fires per PR.
