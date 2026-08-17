---
name: story
description: Create one user story for planning work in the current repo — gather context, propose a draft, then interview the user in batched rounds until no vague part remains before recording it under docs/stories/. Invoked by command only.
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
- The draft is a proposal that seeds the interview in step 3 — never the final word.

## 3. Interview in rounds
Grill the draft in rounds until nothing vague remains; never rush to the preview after a single round.
- Each round, ask every question whose prerequisites are already settled — together, numbered, each with a recommended answer — then revise the draft with the answers. Hold only questions that depend on answers still outstanding.
- Probe every round against the vagueness checklist: story sentence clear on actor, capability, and benefit; every acceptance criterion verifiable pass/fail; Non-Goals bound the scope; technical notes grounded; priority justified. Probe acceptance-criterion testability hardest, and use judgment for anything the checklist does not cover.
- Exit only when the checklist has no unresolved item and the user confirms. The user may end the interview at any time; anything genuinely unanswerable yet goes into `## Open Questions` in the record — never silently dropped, never invented. No fixed round cap.
- The loop runs for both invocation flows once a capability is chosen.

## 4. Preview (repeat until Save or Cancel)
- Title: short imperative phrase derived from the capability (max 72 characters).
- Record path: `docs/stories/<YYYY-MM-DD>-<slug>.md`, slug kebab-cased from the title; append `-2`, `-3`, … if taken.
- Preview the complete record and ask with structured options, repeating until the user picks one:
  - **Save record** — proceed to step 5.
  - **Edit** — free-text changes; apply, re-derive title/slug if needed, preview again. If the edit touches substance (story sentence, acceptance criteria, Non-Goals), re-run the step-3 checklist in one targeted round first; cosmetic edits (title, slug, phrasing) apply directly.
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
