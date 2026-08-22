# Merge story creation and planning into one step

- Date: 2026-08-22

As a maintainer, I want one skill invocation to take a story from rough idea
to a planned GitHub issue set - parent issue plus `task` sub-issues - with
the story and plan persisted only in GitHub issues, so that planning stops
being a verbose two-step, double-interview process and the plan has exactly
one home.

## Acceptance Criteria

1. One invocation of the merged `story` skill (`/story`) carries one story
   from seed (or suggested capability) through the story interview and the
   task-breakdown interview back to back, shows one combined preview (story
   plus task list) before creating anything, and ends with the parent issue
   (label `enhancement`) and its `task`-labeled sub-issues created - no
   second skill invocation; the `plan-a-story` skill no longer exists in
   `.agents/skills/`.
2. For a story created under the merged flow, the parent issue body is the
   only artifact holding the story sentence, acceptance criteria, Non-Goals,
   technical notes, priority, and open questions plus the Tasks checklist;
   no per-story file is written anywhere in the repo.
3. The existing `docs/stories/*.md` records and `docs/stories/README.md`
   are removed in the same change; the in-flight parent #63 continues from
   its issue alone - its body already carries the full story content and
   Tasks checklist, so nothing is lost.
4. A new ADR-0005, indexed in `docs/adr/README.md`, records the decision -
   story creation and planning are one step, and GitHub issues are the
   single source of truth for stories and plans - referencing ADR-0004,
   which stays Accepted.
5. AGENTS.md's repo map and workflow describe the merged flow and carry the
   story lifecycle (planned -> in flight -> done; the Proposed state
   disappears); no live doc presents creation and planning as two stages or
   references `docs/stories/` or `plan-a-story` as active paths.
6. The `bookkeeping` skill's Done step matches the new persistence: close
   parent issues and keep task checklists truthful - no story-record edits
   or index strikes remain.

## Non-Goals

- No changes to `implement-a-task` or `review`: they consume task issues
  and PRs, which keep their shape (neither skill references story records
  or `plan-a-story`).
- No changes to the issue conventions the flow already uses: labels
  (`enhancement`, `task`), sub-issue linkage, checklist format.
- No changes to the locked external skills (`agent-browser`, `grilling`)
  or `skills-lock.json`.
- No tooling beyond the skill markdown: the skills stay prose instructions,
  and issue creation keeps using whatever GitHub access the environment
  provides.
- No git history rewrite: removed records stay retrievable in history, per
  the 2026-08-21 reset precedent.

## Technical Notes

- `story` and `plan-a-story` are repo-owned skills (`skills-lock.json`
  locks only `agent-browser` and `grilling`), so the merge is a local edit
  of `.agents/skills/story/SKILL.md` plus deletion of
  `.agents/skills/plan-a-story/` - no upstream dependency.
- The merged flow's issue shape is today's plan-a-story output minus the
  `**Story record:** docs/stories/<file>` line: parent body = story
  sentence, Acceptance Criteria, Non-Goals, Technical Notes, Priority,
  Open Questions (when any remain), Tasks checklist; each task sub-issue =
  description + AC checkpoint + `Part of #<parent>`.
- The duplication being removed is concrete: plan-a-story step 5 copies the
  record's sections verbatim into the parent body while the record stays
  committed in the repo.
- Verified lossless for the in-flight story: issue #63's body carries the
  full record content (sentence, all ACs, Non-Goals, Technical Notes,
  Priority) plus the Tasks checklist.
- Files touched beyond the two skills: `AGENTS.md` (repo map, workflow
  steps 1-2, bookkeeping step, source-of-truth line), deletion of
  `docs/stories/` (records + README), the `bookkeeping` skill's Done step,
  and the new `docs/adr/0005-*.md` with its ADR index entry.
- This record is created under the current two-step flow and is itself
  removed by this story's implementation (AC 3) - by then this story's
  parent issue carries its content.

## Priority

High - every future story pays the two-step, double-persistence tax today;
the maintainer hits it on each planning cycle.
