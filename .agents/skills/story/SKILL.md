---
name: story
description: Create one user story for planning work in the current repo — gather context, interview with suggested answers, and keep a repo record under docs/stories/. Invoked by command only.
disable-model-invocation: true
---

# Create a planning story

You are loaded when the user types `/story`, optionally followed by a rough idea that seeds the interview (e.g. `/story implement dark mode`), or `/story suggest` to jump straight to the capability candidates. Produce exactly ONE user story per invocation, written in English, recorded in the repo under `docs/stories/`. Creating GitHub issues is not this skill's job — the `plan-a-story` skill turns a recorded story into issues. Do not push anything.

## 1. Gather context
Before asking anything, gather suggestion material:
- This session's conversation history: topics, requests, pain points, or "we should…" ideas that plausibly fit this repo's scope and do not contradict any ADR.
- The repo: `docs/adr/` decisions, `README.md` scope, existing `docs/stories/` records, open GitHub issues, and any TODO/FIXME markers.
Use this material to ground every suggestion below. Never invent needs the context does not contain.

## 2. Interview round 1 — capability (skip when the seed names a capability)
- Offer 3–5 candidates, each: a one-line title, a one-sentence "I want …", and its source label (`from this conversation: "…"` or the ADR/README/issue it derives from).
- Skip ideas already recorded in `docs/stories/` or already open as GitHub issues; instead list them as "Already covered" with a link.
- Present as selectable options plus a free-text override. Vague or contradictory answers get one focused follow-up round.

## 3. Interview round 2 — remaining fields
Ask one structured round with `ask_user_question`; every field offers suggested options plus a free-text override:
1. Actor — who wants this (default suggestion: "user")
2. Benefit — "so that …", derived from the chosen capability's source
3. Acceptance criteria — at least one; multi-select suggestions derived from the capability/source
4. Success signal — how we will know it is done; the answer feeds the acceptance criteria
5. Out of scope — what is explicitly not included; recorded as Non-Goals
6. Technical notes — optional; suggestions are repo-derived context (e.g. relevant ADRs or constraints)
7. Urgency — why now / how urgent; map the answer to a priority: `high`, `medium` (default), or `low`

## 4. Quality pass
Before composing, check the story: benefit clear? acceptance criteria testable? scope bounded (Non-Goals present when relevant)? If a gap exists, ask ONE targeted follow-up naming the exact gap. Anything the user genuinely cannot answer yet goes into `## Open Questions` in the record — never silently dropped, never invented.

## 5. Compose and preview
- Title: short imperative phrase derived from the capability (max 72 characters).
- Record path: `docs/stories/<YYYY-MM-DD>-<slug>.md`, slug kebab-cased from the title; append `-2`, `-3`, … if taken.
- Preview the complete record and ask with structured options, repeating until the user picks one:
  - **Save record** — proceed to step 6.
  - **Edit** — free-text changes; apply, re-derive title/slug if needed, preview again.
  - **Cancel** — write nothing; confirm the cancellation.

## 6. Write the repo record
- Create `docs/stories/` if missing and write the record with this header (no Issue line — it appears only after `plan-a-story`):

```
# <Title>

- Date: <YYYY-MM-DD>
- Status: Proposed
```

followed by: the story sentence (`As a <actor>, I want <capability>, so that <benefit>.`), `## Acceptance Criteria`, `## Non-Goals` (when given), `## Technical Notes` (when given), `## Priority`, and `## Open Questions` (when any). Omit empty sections.
- Update the index `docs/stories/README.md` (create it if missing, including its Status vocabulary section): newest first, `- [<Title>](./<file>) — Proposed`.
- Use only the status values defined in `docs/stories/README.md`.

## 7. Ask how to commit (never push)
Ask with structured options; the default is the first:
- **New branch** — create `docs/story-<slug>` from the current HEAD and commit there (reuse the branch if it already exists).
- **Current branch** — commit here; warn first if the branch is `main` or `master`.
- **Leave uncommitted** — report the path and stop.
Commit message: `docs(story): add <title>`, following the session's commit conventions (Conventional Commits, including the Co-authored-by trailer those instructions require). Never push.

## 8. Report
Summarize: the story record path, the chosen status and priority, the commit outcome (branch/commit hash or uncommitted), and a hint that `plan-a-story` is the next step.
