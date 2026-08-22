---
name: story
description: Create and plan one user story in a single step - gather context, propose the story and its task breakdown, interview in batched rounds until no vague part remains, then create the story's GitHub parent issue with each task as a sub-issue. Invoked by command only.
disable-model-invocation: true
---

# Create and plan a story in one step

You are loaded when the user types `/story`, optionally followed by a rough idea that seeds the proposal (e.g. `/story implement dark mode`), or `/story suggest` to jump straight to capability candidates. Produce exactly ONE story per invocation, in English, and end by creating its GitHub issues. Do not push anything and do not edit any repo files - GitHub issues are the single source of truth for stories and plans (ADR-0005).

## 1. Gather context
Before asking anything, gather:
- The GitHub owner/repo from the session repo's `git remote get-url origin` (accept https and ssh forms). If there is no GitHub remote, stop and tell the user; create nothing.
- This session's conversation history: topics, requests, pain points, or "we should…" ideas that plausibly fit this repo's scope and do not contradict any ADR.
- The repo: `docs/adr/` decisions, `README.md` scope, open GitHub issues, and any TODO/FIXME markers.
- Open GitHub issues: an open parent issue (label `enhancement`) whose title or body matches a candidate means that story is already recorded and planned - point to it and skip the candidate.
Use this material to ground every suggestion below; never invent needs the context does not contain.

## 2. Propose the story
- With a seed: propose a complete story draft - title, actor, capability, benefit, acceptance criteria, Non-Goals, technical notes, priority - grounded in the seed and the gathered context.
- Without a seed: offer 3-5 capability candidates (title + one-sentence "I want …" + source label: `from this conversation: "…"` or the ADR/README/issue it derives from), skipping ideas already recorded (list those as "Already covered" with a link to the parent issue). Once a capability is chosen, propose the full draft around it.
- The draft is a proposal that seeds the interview in step 3 - never the final word.

## 3. Interview the story in rounds
Grill the draft in rounds until nothing vague remains; never rush to the breakdown after a single round.
- Each round, ask every question whose prerequisites are already settled - together, numbered, each with a recommended answer - then revise the draft with the answers. Hold only questions that depend on answers still outstanding.
- Probe every round against the vagueness checklist: story sentence clear on actor, capability, and benefit; every acceptance criterion verifiable pass/fail; Non-Goals bound the scope; technical notes grounded; priority justified. Probe acceptance-criterion testability hardest, and use judgment for anything the checklist does not cover.
- Exit only when the checklist has no unresolved item and the user confirms. The user may end the interview at any time; anything genuinely unanswerable yet goes into `## Open Questions` - it will land in the parent issue - never silently dropped, never invented. No fixed round cap.
- The loop runs for both invocation flows once a capability is chosen.

## 4. Propose and grill the task breakdown
- Propose a complete task breakdown - a draft to grill, not a workable-enough one. Each task is one coherent unit of work (roughly one pull request), with a title, a description of what concretely changes, and the story acceptance criterion (or criteria) it satisfies, in a sensible execution order.
- Grill it in rounds until nothing vague remains; never rush to agreement after a single round. Each round, ask every question whose prerequisites are already settled - together, numbered, each with a recommended answer - then revise the breakdown with the answers. Hold only questions that depend on answers still outstanding.
- Probe every round against the vagueness checklist: every task is one coherent unit (roughly one pull request) with a concrete description of what changes; every story acceptance criterion is covered by at least one task and named as that task's checkpoint; no task contradicts the story's Non-Goals; the execution order is sensible with dependencies stated. Probe task concreteness hardest, and use judgment for anything the checklist does not cover.
- Exit only when the checklist has no unresolved item and the user confirms. The user may end the interview at any time; anything genuinely unanswerable yet goes into `## Open Questions` in the parent issue - never silently dropped, never invented. No fixed round cap.

## 5. Preview (repeat until Create, Edit, or Cancel)
Every round, show the complete plan - the story (title, story sentence, acceptance criteria, Non-Goals, technical notes, priority) and the task list (title, what changes, AC checkpoint) - and ask with structured options:
- **Create** - proceed to step 6.
- **Edit** - free-text changes; apply and preview again. If the edit touches the story's substance (story sentence, acceptance criteria, Non-Goals) or the task list (tasks, checkpoints, order), re-run the relevant checklist in one targeted round first; cosmetic edits (title, wording, phrasing) apply directly.
- **Cancel** - create nothing and change no records; confirm the cancellation.

## 6. Create the issues
- Parent issue first: label `enhancement` (or the user's stated preference), body =
  - the story sentence,
  - `## Acceptance Criteria`,
  - `## Non-Goals`, `## Technical Notes`, `## Priority` when given,
  - `## Open Questions` when any remain,
  - `## Tasks` - a checklist, one line per task.
  There is no story-record line and no repo file - the issue is the story.
- Then each task as a sub-issue of the parent: label `task` (create the label if missing), body = description + the AC checkpoint + `Part of #<parent>`.
- If sub-issues are not possible in this environment, create the tasks as plain issues and link them as `- [ ] #<number>` lines in the parent's Tasks checklist.
- If a task fails to create, continue with the rest, then report which ones failed with the commands needed to create them manually.
- Use whatever GitHub access this environment provides; never print secrets.

## 7. Report
Summarize: the parent issue URL and number, each task's issue URL and number, and any failures. GitHub issues are the source of truth for the story and the plan; nothing was committed or pushed.
