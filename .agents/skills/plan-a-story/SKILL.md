---
name: plan-a-story
description: Plan a recorded story into tasks — gather context, propose a breakdown, then interview the user in batched rounds until nothing vague remains before creating the story's GitHub issue with each task as a sub-issue. Invoked by command only.
disable-model-invocation: true
---

# Plan a story into tasks and issues

You are loaded when the user types `/plan-a-story`. Plan exactly ONE story per invocation, in English. Do not push anything and do not edit any repo files — planning lives in GitHub issues; the story record changes only when the work completes (see `docs/stories/README.md`).

## 1. Gather context
Before asking anything, gather:
- The GitHub owner/repo from the session repo's `git remote get-url origin` (accept https and ssh forms). If there is no GitHub remote, stop and tell the user; plan nothing.
- All `docs/stories/*.md` records — their sentences, acceptance criteria, Non-Goals, notes, priority, open questions.
- This session's conversation history: constraints, decisions, or preferences discussed that fit this repo's scope and do not contradict any ADR.
- The repo: `docs/adr/` decisions, `README.md`, open GitHub issues, TODO/FIXME markers.
- Existing GitHub issues for each story: an open issue whose body references the story record path means the story is already planned (point to it and stop); an issue whose title matches the story title is flagged and confirmed with the user before treating it as planned.
Use this material to ground every suggestion below; never invent constraints the context does not contain.

## 2. Pick the story
- Ask which story to plan, offering the unplanned records (no matching GitHub issue), newest first, as suggested options, plus a free-text override for a directly named record (title or slug).

## 3. Propose and grill the breakdown
- Propose a complete task breakdown — a draft to grill, not a workable-enough one. Each task is one coherent unit of work (roughly one pull request), with a title, a description of what concretely changes, and the story acceptance criterion (or criteria) it satisfies, in a sensible execution order. The draft is a proposal that seeds the interview — never the final word.
- Grill it in rounds until nothing vague remains; never rush to agreement after a single round. Each round, ask every question whose prerequisites are already settled — together, numbered, each with a recommended answer — then revise the breakdown with the answers. Hold only questions that depend on answers still outstanding.
- Probe every round against the vagueness checklist: every task is one coherent unit (roughly one pull request) with a concrete description of what changes; every story acceptance criterion is covered by at least one task and named as that task's checkpoint; no task contradicts the story's Non-Goals; the execution order is sensible with dependencies stated. Probe task concreteness hardest, and use judgment for anything the checklist does not cover.
- Exit only when the checklist has no unresolved item and the user confirms. The user may end the interview at any time; anything genuinely unanswerable yet goes into `## Open Questions` in the parent issue — never silently dropped, never invented. No fixed round cap.

## 4. Agreement rounds (repeat until Create or Cancel)
Every round, show the complete plan — parent issue (title, body, label) and the task list — and ask with structured options:
- **Create** — proceed to step 5.
- **Edit** — free-text changes; apply and preview again. If the edit changes the task list (tasks, checkpoints, order), re-run the step-3 checklist in one targeted round first; cosmetic edits (wording, phrasing) apply directly.
- **Cancel** — create nothing and change no records; confirm the cancellation.

## 5. Create the issues
- Parent issue first: label `enhancement` (or the user's stated preference), body =
  - the story sentence,
  - `## Acceptance Criteria`,
  - `## Non-Goals`, `## Technical Notes`, `## Priority` when the record has them,
  - `## Open Questions` when any remain,
  - `**Story record:** docs/stories/<file>`,
  - `## Tasks` — a checklist, one line per task.
- Then each task as a sub-issue of the parent: label `task` (create the label if missing), body = description + the AC checkpoint + `Part of #<parent>`.
- If sub-issues are not possible in this environment, create the tasks as plain issues and link them as `- [ ] #<number>` lines in the parent's Tasks checklist.
- If a task fails to create, continue with the rest, then report which ones failed with the commands needed to create them manually.
- Use whatever GitHub access this environment provides; never print secrets.

## 6. Report
Summarize: the parent issue URL and number, each task's issue URL and number, and any failures. The story record stays untouched; GitHub issues are the source of truth for the plan.
