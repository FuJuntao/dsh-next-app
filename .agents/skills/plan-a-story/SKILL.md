---
name: plan-a-story
description: Plan a recorded story into tasks — interview the user, draft a breakdown, then create the story's GitHub issue with each task as a sub-issue. Invoked by command only.
disable-model-invocation: true
---

# Plan a story into tasks and issues

You are loaded when the user types `/plan-a-story`. Plan exactly ONE story per invocation, in English: pick an unplanned story record, interview the user, draft a task breakdown, and once agreed, create the story's GitHub issue with each task as a sub-issue. Do not push anything.

## 1. Resolve the target repo
- Derive the GitHub owner/repo from the repository the session is working in: `git remote get-url origin`, accepting `https://github.com/<owner>/<repo>.git` and `git@github.com:<owner>/<repo>.git`.
- If there is no GitHub remote, stop and tell the user; plan nothing.

## 2. Pick the story
- List `docs/stories/*.md` records that have no `Issue:` line, newest first, and let the user pick one. If the user names a record directly (title or slug), use it.
- If the chosen record already has an `Issue:` line, point to that issue and stop — unless the user explicitly asks to re-plan it.

## 3. Interview (one structured round)
Ask a single round with the `ask_user_question` tool:
1. Ambiguities — anything the story leaves open about scope or intent
2. Constraints — technical constraints, preferences, or dependencies to respect
3. Granularity — how fine or coarse the user wants the tasks
If the answers stay unclear, ask one focused follow-up round. Never invent answers.

## 4. Draft the task breakdown
- From the story's acceptance criteria and the interview, draft an ordered task list. Each task is one coherent unit of work (roughly one pull request), with:
  - Title: short imperative phrase
  - Description: what concretely changes
  - AC checkpoint: the story acceptance criterion (or criteria) this task satisfies
- Order tasks in a sensible execution sequence. Show the draft as part of the next step's preview.

## 5. Agreement rounds (repeat until Create or Cancel)
Every round, show the complete plan — parent issue (title, body, label) and the task list — and ask with structured options:
- **Create** — proceed to step 6.
- **Edit** — a free-text field for changes; apply them and show the preview again.
- **Cancel** — create nothing and change no records; confirm the cancellation.
Never create anything until the user picks Create.

## 6. Create the issues
- Parent issue first: label `enhancement` (or the user's stated preference), body =
  - the story sentence (`As a … I want … so that …`),
  - Acceptance Criteria,
  - Technical Notes and Priority when the record has them,
  - `**Story record:** docs/stories/<file>`,
  - `## Tasks` — a checklist, one line per task.
- Then each task as a sub-issue of the parent: label `task` (create the label if it does not exist), body = description + the AC checkpoint + `Part of #<parent>`.
- If sub-issues are not possible in this environment, create the tasks as plain issues and link them as `- [ ] #<number>` lines in the parent's Tasks checklist.
- If a task fails to create, continue with the rest, then report which ones failed with the commands needed to create them manually.
- Use whatever GitHub access this environment provides; never print secrets.

## 7. Update the story record
- Add `Issue: <parent issue URL>` to the record header and change `Status: Proposed` to `Status: Planned`.
- Append a `## Tasks` section listing each task with its issue link.
- Update the index entry to `- [<Title>](./<file>) — Planned — #<parent>`.

## 8. Commit the changes (never push)
- If the current branch is not `main` or `master`: `git add` the updated record (and index if changed) and commit with `docs(story): plan <title>`, following the session's commit conventions (Conventional Commits, including the Co-authored-by trailer those instructions require).
- If on `main` or `master`: do not commit; report the uncommitted paths and let the user commit.

## 9. Report
Summarize: the parent issue URL and number, each task's issue URL and number, the updated story record path, the commit hash if one was made, and any failures or uncommitted leftovers.
