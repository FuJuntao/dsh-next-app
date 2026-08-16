---
name: story
description: Create one user story for planning work in the current repo — gather context, propose a draft, fill gaps with the user, and keep a repo record under docs/stories/. Invoked by command only.
disable-model-invocation: true
---

# Create a planning story

You are loaded when the user types `/story`, optionally followed by a rough idea that seeds the proposal (e.g. `/story implement dark mode`), or `/story suggest` to jump straight to capability candidates. Produce exactly ONE user story per invocation, written in English, recorded in the repo under `docs/stories/`. Creating GitHub issues is not this skill's job — the `plan-a-story` skill turns a recorded story into issues. Do not push anything.

## 1. Gather context
Before asking anything, gather suggestion material:
- This session's conversation history: topics, requests, pain points, or "we should…" ideas that plausibly fit this repo's scope and do not contradict any ADR.
- The repo: `docs/adr/` decisions, `README.md` scope, existing `docs/stories/` records, open GitHub issues, and any TODO/FIXME markers.
Use this material to ground every suggestion below. Never invent needs the context does not contain.

## 2. Propose the story
- With a seed: propose a complete story draft — title, actor, capability, benefit, acceptance criteria, Non-Goals, technical notes, priority — grounded in the seed and the gathered context.
- Without a seed: offer 3–5 capability candidates (title + one-sentence "I want …" + source label: `from this conversation: "…"` or the ADR/README/issue it derives from), skipping ideas already recorded in `docs/stories/` or already open as GitHub issues (list those as "Already covered" with a link). Once a capability is chosen, propose the full draft around it.
- Interview the user only about what is missing or blocking a clear story, one focused question at a time, with suggested answers plus free-text overrides. Then revise the proposal.

## 3. Quality pass
Before the preview, check the story: benefit clear? acceptance criteria testable? scope bounded (Non-Goals present when relevant)? If a gap exists, ask ONE targeted follow-up naming the exact gap. Anything the user genuinely cannot answer yet goes into `## Open Questions` in the record — never silently dropped, never invented.

## 4. Preview (repeat until Save or Cancel)
- Title: short imperative phrase derived from the capability (max 72 characters).
- Record path: `docs/stories/<YYYY-MM-DD>-<slug>.md`, slug kebab-cased from the title; append `-2`, `-3`, … if taken.
- Preview the complete record and ask with structured options, repeating until the user picks one:
  - **Save record** — proceed to step 5.
  - **Edit** — free-text changes; apply, re-derive title/slug if needed, preview again.
  - **Cancel** — write nothing; confirm the cancellation.

## 5. Write the repo record
- Create `docs/stories/` if missing and write the record with this header (no Issue or Status line — see `docs/stories/README.md` for the lifecycle):

```
# <Title>

- Date: <YYYY-MM-DD>
```

followed by: the story sentence (`As a <actor>, I want <capability>, so that <benefit>.`), `## Acceptance Criteria`, `## Non-Goals` (when given), `## Technical Notes` (when given), `## Priority`, and `## Open Questions` (when any). Omit empty sections.
- Update the index `docs/stories/README.md` (create it if missing): newest first, `- [<Title>](./<file>)`.

## 6. Ask how to commit (never push)
Ask with structured options; the default is the first:
- **New branch** — create `docs/story-<slug>` from the current HEAD and commit there (reuse the branch if it already exists).
- **Current branch** — commit here; warn first if the branch is `main` or `master`.
- **Leave uncommitted** — report the path and stop.
Commit message: `docs(story): add <title>`, following the session's commit conventions (Conventional Commits, including the Co-authored-by trailer those instructions require). Never push.

## 7. Report
Summarize: the story record path, the commit outcome (branch/commit hash or uncommitted), and a hint that `plan-a-story` is the next step.
