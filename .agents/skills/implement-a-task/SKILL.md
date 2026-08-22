---
name: implement-a-task
description: Carry one planned task from its GitHub issue to a reviewable pull request - gather context, agree on a plan, implement, verify, and publish behind an explicit per-PR gate. Invoked by command only.
disable-model-invocation: true
---

# Implement a planned task

You are loaded when the user types `/implement-a-task`, optionally followed by a task issue number or URL (e.g. `/implement-a-task 12`). Implement exactly the chosen task per invocation. This skill ends when the pull request is open: post-merge review, closing, and bookkeeping belong to the `review` and `bookkeeping` skills. Do not push anything until the publication gate (step 6) is explicitly approved.

## 1. Pick the task
- With an argument: resolve it to exactly one open `task`-labeled issue. If it does not resolve, or is not a task issue, say so and stop.
- Without: list the open `task`-labeled issues with their parent issues and let the user pick.
- Refuse the task and point back to `/story` if it is too big, too vague to implement, or blocked by an unfinished sibling task. Never silently re-scope a task.

## 2. Gather context
Before planning, read: the task issue and its parent issue (the AC checkpoint; the story's content lives in the parent issue body), ADRs relevant to the change, TODO/FIXME markers in the area being touched, and whatever contributor conventions (AGENTS.md or equivalent) apply in the environment this runs in. Never invent constraints the context does not contain.

## 3. Agree on the plan
Present a concise implementation plan - workspace and branch, what concretely changes, the verification you will run, and the PR outline. Then judge the task's clarity and complexity: a clear, simple task needs only the user's approval of the plan; a complex or ambiguous one - open decisions, cross-cutting changes, unstated assumptions - must additionally be stress-tested with this repo's `grilling` skill (`.agents/skills/grilling/`), running its rounds until nothing is left silently assumed. Implementation begins only when the user approves the resulting shared understanding. Chat only: persist nothing at this step; the PR body becomes the durable record of what was agreed.

## 4. Implement
Follow the branch and commit conventions of the environment you run in; they are stated wherever this skill is used and are not restated here. One logical change per commit. All work stays local.

## 5. Verify
Run verification appropriate to the task: build and tests for code, link/render check for docs, dry-run or lint for config and CI changes. If the repo defines no verification yet, establish that explicitly rather than skipping silently. The PR body must state what was run - or that nothing exists to run.

## 6. Publication gate
Show the user the result - the changes, the commits, and the verification outcome - and wait for an explicit "open the PR" go-ahead. Never push to `main`. On approval, push the branch and open a PR whose body uses closing syntax (`Closes #<task>`), summarizes the changes, and states the verification result. The gate fires per PR.
