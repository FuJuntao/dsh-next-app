# Add an implement-a-task skill

- Date: 2026-08-17

As a contributor, I want a skill that carries a planned task from its GitHub issue to a reviewable pull request - plan agreement, implementation, gated publication, so that planned work of any kind (code, docs, config, CI) moves to review without me re-gathering context or improvising the workflow.

## Acceptance Criteria

1. The skill is user-invoked by command (e.g. `/implement-a-task`) with the task named as an issue number/URL (fallback: picking among open `task`-labeled sub-issues); `disable-model-invocation: true`, like the existing skills.
2. Before planning, it gathers context: the task issue and its parent issue, the linked story record, relevant ADRs, and whatever contributor conventions (AGENTS.md or equivalent) apply in the environment it runs in.
3. It includes a **plan step**: a chat-only agreement round on the implementation approach before work begins - nothing persisted; the PR body is the durable record of what was agreed.
4. It refuses tasks that are too big, too vague, or blocked by unfinished siblings, and points back to `/plan-a-story` - it never silently re-scopes a task.
5. It runs **task-appropriate verification** before publishing (build/tests for code, link/render check for docs, dry-run/lint for config or CI), and the PR body always states what was run - or explicitly that the repo defines none yet.
6. Publication is **gated**: all work stays local until an explicit "open the PR" go-ahead; the gate fires per PR; it never pushes to `main`.
7. The PR references the task issue with closing syntax (`Closes #N`) and summarizes the changes.
8. The skill is **runtime-agnostic**: it assumes no particular runtime, host, or deployment environment; environment-specific rules come from whatever contributor instructions are in effect where it runs. It references conventions; it does not restate them.
9. It ships as `.agents/skills/implement-a-task/SKILL.md` with the family frontmatter (`name`, `description`, `disable-model-invocation: true`), and the skill text stays lean - no PR-count policy or environment-specific mechanics baked in.

## Non-Goals

- Creating or editing stories and plans - that stays with `story` and `plan-a-story`.
- Post-merge work: reviewing, merging, closing issues, and the story-record Done step - a separate review skill, to be built later.
- Auto-merging PRs, managing CI, or deploying.

## Priority

High - exercisable immediately by the repo's actual (docs/workflow) output.

## Open Questions

- Interim plan-status freshness: task issues and the parent checklist update themselves via PR closing syntax, but the story-record Done step is manual until the review skill exists. Should the existing skills opportunistically offer the one-line record fix when they detect a completed-but-unmarked story, or does this wait for the review skill?

  > Resolved 2026-08-18 by the review-and-bookkeeping story ([2026-08-18 record](./2026-08-18-add-review-and-bookkeeping-skills-plus-a-contributor-doc.md), AC 9): record freshness belongs to the `bookkeeping` skill; the other skills never edit records post-merge.
