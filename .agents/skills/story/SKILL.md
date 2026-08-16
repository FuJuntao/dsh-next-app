---
name: story
description: Create one user story for planning work in the current repo — interview the user and keep a repo record under docs/stories/. Invoked by command only.
disable-model-invocation: true
---

# Create a planning story

You are loaded when the user types `/story`, optionally followed by a rough idea that seeds the interview (e.g. `/story implement dark mode`). Produce exactly ONE user story per invocation, written in English, recorded in the repo under `docs/stories/`. Creating GitHub issues is not this skill's job — the `plan-a-story` skill turns a recorded story into issues. Do not push anything.

## 1. Interview (one structured round)
Ask a single round with the `ask_user_question` tool, pre-filling anything the seed already contains:
1. Actor — "As a …" (who wants this)
2. Capability — "I want …" (what they want)
3. Benefit — "so that …" (why it matters)
4. Acceptance criteria — at least one item; accept several
5. Technical notes — optional
6. Priority — optional, free text
If any answer is vague or contradictory, ask one focused follow-up round. Never invent answers.

## 2. Compose the story
- Title: a short imperative phrase derived from the capability (e.g. "Add dark mode"), at most 72 characters.
- Fix the record path now: `docs/stories/<YYYY-MM-DD>-<slug>.md`, slug kebab-cased from the title. If that path already exists, append `-2`, `-3`, … until free.

## 3. Preview loop (repeat until Save or Cancel)
Every round, show the complete story — title and record content — and ask with structured options:
- **Save record** — proceed to step 4.
- **Edit** — a free-text field for changes; apply them, re-derive the title/slug if the capability changed, and show the preview again.
- **Cancel** — write nothing; confirm the cancellation.
Never write the record until the user picks Save record.

## 4. Write the repo record
- Create `docs/stories/` if it does not exist, then write the record with an ADR-style header (no Issue line — a story gains one only after `plan-a-story` plans it):

```
# <Title>

- Date: <YYYY-MM-DD>
- Status: Proposed
```

followed by the story sentence (`As a <actor>, I want <capability>, so that <benefit>.`), Acceptance Criteria, Technical Notes, and Priority (omit sections with no content).
- Keep the index `docs/stories/README.md` current: a bullet list, newest first, of `- [<Title>](./<file>) — Proposed`.

## 5. Commit the record (never push)
- If the current branch is not `main` or `master`: `git add` the record (and the index if it changed) and commit with `docs(story): add <title>`, following the session's commit conventions (Conventional Commits, including the Co-authored-by trailer those instructions require).
- If on `main` or `master`: do not commit; report the uncommitted path and let the user commit.

## 6. Report
Summarize: the story record path, the commit hash if one was made, anything left uncommitted, and a hint that `plan-a-story` is the next step.
