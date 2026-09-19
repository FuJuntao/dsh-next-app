---
name: implement
description: Carry one story from its GitHub issue to a reviewable pull request - gather context, agree on a plan and a slice when the story is too large for one PR, implement, verify, and publish behind an explicit per-PR gate. Invoked by command only.
disable-model-invocation: true
---

# Implement a story

You are loaded when the user types `/implement`, optionally followed by a story issue number or URL (e.g. `/implement 12`). Implement exactly the chosen story per invocation, in one pull request; when the story is too large for one PR, step 3 agrees a slice and this invocation delivers that slice. This skill ends when the pull request is open: post-merge review, closing, and bookkeeping belong to the `review` and `bookkeeping` skills. Do not push anything until the publication gate (step 6) is explicitly approved.

## 1. Pick the story
- With an argument: resolve it to exactly one open story issue (normally label `enhancement`). If it does not resolve, or is not a story issue, say so and stop.
- Without: list the open story issues (normally label `enhancement`) and let the user pick.
- Refuse the story and point back to `/story` if it is too vague to implement. Never silently re-scope a story; sizing is settled in step 3, not by refusal.

## 2. Gather context
Before planning, read: the story issue (story sentence, acceptance criteria, Non-Goals, open questions - the issue is the story), its `## Design` packet when present - it is a binding constraint on behavior, states, and copy; deviate only with the user's explicit agreement, never silently - ADRs relevant to the change, TODO/FIXME markers in the area being touched, and whatever contributor conventions (AGENTS.md or equivalent) apply in the environment this runs in. Never invent constraints the context does not contain.

## 3. Agree on the plan and the slice
Present a concise implementation plan - workspace and branch, what concretely changes, the verification you will run, and the PR outline. If the story is too large for one PR, agree the slice now: which acceptance criteria this PR delivers and which are left for later, recorded in the PR outline. Then judge the story's clarity and complexity: a clear, simple story needs only the user's approval of the plan; a complex or ambiguous one - open decisions, cross-cutting changes, unstated assumptions - must additionally be stress-tested with this repo's `grilling` skill (`.agents/skills/grilling/`), running its rounds until nothing is left silently assumed. Implementation begins only when the user approves the resulting shared understanding. Chat only: persist nothing at this step; the PR body becomes the durable record of what was agreed.

## 4. Implement
Follow the branch and commit conventions of the environment you run in; they are stated wherever this skill is used and are not restated here. One logical change per commit. All work stays local.

## 5. Verify
Run verification appropriate to the change: build and tests for code, link/render check for docs, dry-run or lint for config and CI changes. If the repo defines no verification yet, establish that explicitly rather than skipping silently. The PR body must state what was run - or that nothing exists to run.

## 6. Publication gate
Show the user the result - the changes, the commits, and the verification outcome - and wait for an explicit "open the PR" go-ahead. Never push to `main`. On approval, push the branch and open a PR whose body summarizes the changes, states the verification result, and links the story issue: `Closes #<story>` when the PR delivers every acceptance criterion, otherwise `Part of #<story>` with the slice's criteria listed - `bookkeeping` closes the story when its remaining work merges. The gate fires per PR.
