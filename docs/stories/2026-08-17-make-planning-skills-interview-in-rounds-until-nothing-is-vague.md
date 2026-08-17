# Make planning skills interview in rounds until nothing is vague

- Date: 2026-08-17

As a contributor, I want the `story` and `plan-a-story` skills to interview me about their drafts in repeated rounds of targeted questions until no vague part remains, so that recorded stories and their task plans are precise the first time and downstream work proceeds without re-discovering missing decisions.

## Acceptance Criteria

1. `story/SKILL.md` replaces its “one focused question at a time” interview and “ONE targeted follow-up” quality pass with a single multi-round interview loop; `plan-a-story/SKILL.md` replaces its “propose a task breakdown as soon as you have a workable draft, even with gaps” rush clause and “one focused question at a time” interview the same way. Both loops are self-contained in their skills - no dependency on the grilling skill or any external skill.
2. Both loops start from a complete proposed draft - the story draft for `/story`, the full task breakdown for `/plan-a-story` - and run in batched rounds: every currently-answerable question asked at once, numbered, each with a recommended answer.
3. `story`'s vagueness checklist: story sentence (actor, capability, benefit), every acceptance criterion verifiable pass/fail, Non-Goals bound the scope, technical notes grounded, priority justified. `plan-a-story`'s: every task is one coherent unit (roughly one PR) with a concrete “what changes” description; every story acceptance criterion covered by at least one task and named as that task's checkpoint; no task contradicts the story's Non-Goals; execution order sensible with dependencies stated; unresolvable items go to the parent issue's Open Questions.
4. The checklists are floors - judgment may probe beyond them; acceptance-criterion testability (`story`) and task concreteness (`plan-a-story`) are probed hardest.
5. Exit semantics are identical in both: the checklist has no unresolved item, confirmed by the user; the user may end the interview at any time; genuinely unresolvable items are recorded as Open Questions - in the story record for `/story`, in the parent issue body for `/plan-a-story` - never silently dropped, never invented. No fixed round cap.
6. Both preview loops get an edit guard: substantive edits (story sentence, acceptance criteria, Non-Goals; task-list structure) re-run the checklist in one targeted round; cosmetic edits (title, slug, phrasing) apply directly.
7. Everything else is unchanged: `/story` steps 4-7 (preview, record, commit, report), `/plan-a-story` steps 4-6 (agreement rounds, issue creation, report), and the story-record and issue formats.

## Non-Goals

- `implement-a-task` and all other skills are untouched.
- No changes to outputs: the story record format and `plan-a-story`'s issue structure stay as-is.
- No automated or tool-based vagueness detection - the checklists are instructions to the interviewing agent.
- No new frontmatter fields or invocation flags; only the `description` lines change.

## Technical Notes

- Edit `.agents/skills/story/SKILL.md` and `.agents/skills/plan-a-story/SKILL.md` only; keep the family frontmatter (`name`, `description`, `disable-model-invocation: true`) and lean skill text.
- Update both `description` frontmatter lines to mention the multi-round interview.
- No `skills-lock.json` change: it tracks externally sourced skills only (grilling); both edited skills are repo-native.

## Priority

High - it gates the quality of every future story record and plan, and is exercisable on the next `/story` or `/plan-a-story` invocation.

## Open Questions

- Should `implement-a-task`'s plan-agreement round get the same multi-round treatment once this proves out?
