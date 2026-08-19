# Post review findings as anchored PR comments

- Date: 2026-08-20

As a maintainer, I want the findings the `review` skill produces posted on the pull request as review comments anchored to the exact lines they refer to, so that I can act on them directly on the PR without guessing from a chat transcript which line each one means.

## Acceptance Criteria

1. When `/review` reaches a verdict (approve or request-changes), it posts the full structured verdict on the PR as one review anchored to the HEAD commit reviewed: a summary body (outcome, axes ran/skipped) plus one inline review comment per finding that references a specific location in the PR diff, anchored to the file path and line — or start–end line range when the finding spans lines. Blockers and non-blocking observations alike are anchored. The review carries no formal approve/request-changes platform state; it posts as a plain comment review, so it never blocks merge on its own.
2. All findings of a pass share one continuous numbering across the summary body and the inline comments; each posted finding keeps its axis tag and traceability to its source (task AC, ADR, convention). The posted content is the complete verdict — nothing formerly chat-only is dropped.
3. Findings with no anchor in the PR diff — repo-wide or process findings (a missing verification claim, commit hygiene, issue/checklist mismatches) and findings that reference code outside the diff — appear in the review summary body instead.
4. Chat output shrinks to a minimal summary: the outcome, finding counts, and a link to the posted review. Any finding that failed to post keeps its number from the same continuous sequence and stays in chat in full — findings are never silently lost. The merge go-ahead conversation stays in chat, and the merge gate itself is unchanged.
5. A re-review is a new invocation and posts a fresh review for its own pass; it does not edit or delete earlier reviews. It also inspects open review-comment threads created by earlier skill passes: a thread is marked resolved only when this pass verifies the anchored finding no longer holds. Threads created by humans are never touched.
6. When posting or resolving is unavailable (no platform tooling or no auth), the skill says so plainly and the full verdict remains in chat.
7. The `review` skill stays platform-agnostic in its normative text — "post via the platform", never a specific CLI — and ships as an edit to `.agents/skills/review/SKILL.md` that drops the "comment on the PR only if the user asks" rule. Repo docs that state the old behavior are updated in the same change (ADR-0005).

## Non-Goals

- Suggesting, committing, or pushing code fixes — the review stays read-only over code; resolving a thread marks the conversation, nothing more.
- Changing the review axes, the verdict semantics, or the merge gate.
- Bot accounts, webhooks, or CI-triggered reviews; `/review` stays user-invoked by command.
- Editing or deleting previously posted reviews.
- Resolving review threads created by humans.
- Any platform but the one this repo lives on (GitHub).

## Technical Notes

- The `review` skill is repo-owned — root `skills-lock.json` locks only `agent-browser` and `grilling` — so the change is an edit to `.agents/skills/review/SKILL.md`.
- The skill text must instruct the reviewer to record anchor data (file path, line or line range, HEAD commit SHA) as each finding is gathered during the axis passes; the chat-only verdict never needed it.
- Concrete mechanisms in this environment (the `gh` CLI, already used at the merge gate): one atomic post via the pulls/reviews endpoint (summary body + comments array with `path`/`line`/`start_line`/`side`/`commit_id`, plain comment event); thread resolution needs the GraphQL `resolveReviewThread` mutation, which REST does not expose. Skill-created threads are recognized by the posting account plus the skill's own comment format.
- The implementing PR can verify by dogfooding: run the updated skill on a real open PR and check the posted review, the anchors, the minimal chat summary, and — on a second pass after a fix — the resolve behavior.

## Priority

Medium — it raises the quality of every review pass and removes real friction (mapping chat blockers to lines), but nothing is blocked without it today.
