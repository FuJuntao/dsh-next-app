# ADR-0013: Story planning ends at the story — the task breakdown is dropped

Status: Accepted

Date: 2026-09-19

## Context

ADR-0005 merged story creation and planning into one step and gave the
merged `story` skill a second interview: once the story settles, it
proposes a task breakdown and grills it in its own rounds before the
combined preview and issue creation. In practice that second grill is
the slow part of planning. Every story pays a full propose-and-grill
cycle to derive tasks, and the derived plan rarely changes what gets
built - the story's acceptance criteria already state what done means,
and the concrete steps are re-derived against the real code during
implementation anyway, so the extra round does not produce better
output. The breakdown also spreads a plan-maintenance burden across the
whole skill family: the parent issue carries a Tasks checklist that must
stay truthful, design places its packet relative to it, review reads a
task's AC checkpoint, and bookkeeping closes parents from completed
checklists.

## Decision

- **Story planning stops at the story.** The `story` skill gathers
  context, proposes the story, interviews it in rounds, previews it, and
  creates the story's issue - story sentence, acceptance criteria,
  Non-Goals, technical notes, priority, open questions. No task
  breakdown and no parent/child hierarchy: no second interview, no
  `## Tasks` checklist, no `task`-labeled sub-issues - a story has
  exactly one issue, and the issue is the story.
- **Acceptance criteria are the implementation contract.** Work runs
  directly against the story issue: a pull request closes the story -
  or a coherent slice of it, agreed during implementation planning when
  the story is too large for one PR - and review checks the PR against
  the story's acceptance criteria, not a per-task checkpoint.
- The story lifecycle stays documented in AGENTS.md, where the workflow
  lives, and loses its checklist states: **planned** (the story's issue
  exists) -> **in flight** (a PR against the story is open) -> **done**
  (its PRs are merged and `bookkeeping` closes the story issue).
- ADR-0005's remaining decisions stand: the story skill is still one
  step, GitHub issues are still the single source of truth for stories
  and plans, and no per-story repo file is written. This record
  supersedes only ADR-0005's task-breakdown clauses.

## Consequences

- Planning costs one interview instead of two, and the story's issue is
  complete the moment it is created; nothing downstream depends on a
  task list staying in sync with it.
- The task-referencing skills follow in the implementing change: `design`
  places its packet in the story issue without reference to a Tasks
  section; `implement` (renamed from `implement-a-task`) picks up
  stories - their story issues - instead of task issues, keeping its
  plan-agreement step as the place where a large story gets sliced into
  an agreed set of acceptance criteria; `review` reads the story's
  acceptance criteria; `bookkeeping` closes story issues from merged PRs
  instead of completed checklists.
- ADR-0004's frozen "task lists stay truthful" clause has nothing left
  to govern; record truthfulness now rests wholly on the issue records.
- Stories planned under ADR-0005 keep their existing task issues and
  checklists; the old mechanics stay truthful for them until they close.
