---
name: plan-a-story
description: Plan a recorded story into tasks — gather context, propose a breakdown, agree with the user, then create the story's GitHub issue with each task as a sub-issue. Invoked by command only.
disable-model-invocation: true
---

# Plan a story into tasks and issues

You are loaded when the user types `/plan-a-story`. Plan exactly ONE story per invocation, in English. Do not push anything.

## 1. Gather context
Before asking anything, gather:
- The GitHub owner/repo from the session repo's `git remote get-url origin` (accept https and ssh forms). If there is no GitHub remote, stop and tell the user; plan nothing.
- All `docs/stories/*.md` records — their sentences, acceptance criteria, Non-Goals, notes, priority, open questions, and which ones have no `Issue:` line yet.
- This session's conversation history: constraints, decisions, or preferences discussed that fit this repo's scope and do not contradict any ADR.
- The repo: `docs/adr/` decisions, `README.md`, open GitHub issues, TODO/FIXME markers.
Use this material to ground every suggestion below; never invent constraints the context does not contain.

## 2. Pick the story (first question)
- Ask which story to plan, offering the unplanned records (no `Issue:` line), newest first, as suggested options, plus a free-text override for a directly named record (title or slug).
- If the chosen record already has an `Issue:` line, point to that issue and stop — unless the user explicitly asks to re-plan it.

## 3. Propose the breakdown
- Propose a task breakdown as soon as you have a workable draft, even with gaps. Each task is one coherent unit of work (roughly one pull request), with a title, a description of what concretely changes, and the story acceptance criterion (or criteria) it satisfies, in a sensible execution order.
- Interview the user only about what is missing or blocking agreement — e.g. ambiguities, constraints, or granularity the context does not answer. Ask one focused question at a time, then revise the proposal.
- Check before each revision: every acceptance criterion covered by at least one task; no task contradicts the story's Non-Goals; the order is sensible. Anything that genuinely cannot be resolved yet goes into `## Open Questions` in the record — never silently dropped, never invented.

## 4. Agreement rounds (repeat until Create or Cancel)
Every round, show the complete plan — parent issue (title, body, label) and the task list — and ask with structured options:
- **Create** — proceed to step 5.
- **Edit** — free-text changes; apply and preview again.
- **Cancel** — create nothing and change no records; confirm the cancellation.

## 5. Create the issues
- Parent issue first: label `enhancement` (or the user's stated preference), body =
  - the story sentence,
  - `## Acceptance Criteria`,
  - `## Non-Goals`, `## Technical Notes`, `## Priority` when the record has them,
  - `## Open Questions` when the record has any,
  - `**Story record:** docs/stories/<file>`,
  - `## Tasks` — a checklist, one line per task.
- Then each task as a sub-issue of the parent: label `task` (create the label if missing), body = description + the AC checkpoint + `Part of #<parent>`.
- If sub-issues are not possible in this environment, create the tasks as plain issues and link them as `- [ ] #<number>` lines in the parent's Tasks checklist.
- If a task fails to create, continue with the rest, then report which ones failed with the commands needed to create them manually.
- Use whatever GitHub access this environment provides; never print secrets.

## 6. Update the story record
- Add `Issue: <parent issue URL>` to the header and change `Status: Proposed` to `Status: Planned`.
- Append `## Tasks` listing each task with its issue link, and `## Open Questions` when the planning left any.
- Update the index entry to `- [<Title>](./<file>) — Planned — #<parent>`.
- Use only the status values defined in `docs/stories/README.md`.

## 7. Ask how to commit (never push)
Ask with structured options; the default is the first:
- **New branch** — create `docs/story-<slug>` from the current HEAD and commit there (reuse the branch if it already exists).
- **Current branch** — commit here; warn first if the branch is `main` or `master`.
- **Leave uncommitted** — report the paths and stop.
Commit message: `docs(story): plan <title>`, following the session's commit conventions (Conventional Commits, including the Co-authored-by trailer those instructions require). Never push.

## 8. Report
Summarize: the parent issue URL and number, each task's issue URL and number, the updated story record path, the commit outcome, and any failures or uncommitted leftovers.
