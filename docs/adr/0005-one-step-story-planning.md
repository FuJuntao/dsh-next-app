# ADR-0005: Story planning — one step with GitHub issues as the single source of truth

Status: Accepted

Date: 2026-08-22

## Context

The planning workflow runs in two steps: the `story` skill records a user
story under `docs/stories/`, then the `plan-a-story` skill breaks it into a
parent issue with `task`-labeled sub-issues. The second step copies the
record's sections - story sentence, acceptance criteria, Non-Goals,
technical notes, priority - verbatim into the parent issue body, so every
story's content exists twice: in a committed repo file and in GitHub issues.
The two-step flow also costs two verbose interview sessions per story.
Issue #63 shows the issue side is already self-sufficient: its body carries
the full story plus the task checklist on its own.

## Decision

- Story creation and planning are **one step**: a single merged `story`
  skill (`/story`) carries a story from seed (or suggested capability)
  through the story interview and the task-breakdown interview in one
  session, shows one combined preview, and creates the parent issue with
  its `task`-labeled task issues. The `plan-a-story` skill is retired.
- **GitHub issues are the single source of truth for stories and plans**:
  the parent issue body holds the story sentence, acceptance criteria,
  Non-Goals, technical notes, priority, and open questions plus the Tasks
  checklist; task issues hold the plan. No per-story file is written in the
  repo; `docs/stories/` is retired, and removed records stay retrievable in
  git history, per the 2026-08-21 reset precedent.
- The story lifecycle becomes **planned -> in flight -> done** (a story is
  born planned); the Proposed state disappears. The lifecycle is documented
  in AGENTS.md, where the workflow lives.
- The `bookkeeping` skill's Done step becomes closing parent issues and
  keeping task checklists truthful; story-record edits and index strikes
  disappear with the records.
- ADR-0004 stays Accepted: this record refines where story and plan context
  lives - decisions (ADRs) and operations (README, AGENTS.md) stay repo
  files; stories and plans live in GitHub issues, which agents read
  alongside the repo.

## Consequences

- Story creation no longer commits repo files; the double persistence of
  every story's content is gone.
- In-flight stories created under the old flow continue from their issues -
  #63's body is already complete, so retiring its record loses nothing.
- The mechanics land in the implementing PR(s): the merged skill, the
  `docs/stories/` removal, and the AGENTS.md and bookkeeping updates.
- Agents pick up stories and plans from GitHub issues and decisions from
  `docs/adr/`; ADR-0004's discipline otherwise stands.
