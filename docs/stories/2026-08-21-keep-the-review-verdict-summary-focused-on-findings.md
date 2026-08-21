# Keep the review verdict summary focused on findings

- Date: 2026-08-21

As a maintainer, I want the `review` skill to post a verdict whose summary body holds only the outcome, the axes, and findings with no anchor in the diff, so that anchored findings exist once — in their inline threads — and PR comments stay scannable.

## Acceptance Criteria

1. On request-changes, the summary body is the outcome line, one line of axes ran and one of axes skipped, and every unanchorable finding in full — nothing else. Anchored findings exist only as inline review comments; at most a one-line pointer to them may appear in the summary.
2. On approve, the summary body is the verdict: outcome line, axes ran/skipped, and one compact line per axis that ran.
3. Reviewer-internal detail (merge dry runs, re-run/build logs) and process notes the PR cannot act on (such as worktree-convention slips) never appear in the posted verdict; they go in chat, and chat-only notes never get a finding number.
4. Findings keep one continuous numbering across the posted content; every posted finding opens with the `[review] <axis> #<number>` marker and keeps its axis tag and traceability to its source.
5. The step-4 contract wording is internally consistent — no bullet restates or contradicts another (review #2 on PR #58).

## Non-Goals

- Changing the review axes, verdict semantics, or the merge gate.
- Editing the done record `docs/stories/2026-08-20-post-review-findings-as-anchored-pr-comments.md` or its index entry.
- Changing how inline comments are anchored or how re-review threads are recognized.

## Technical Notes

- The `review` skill is repo-owned; the change is an edit to `.agents/skills/review/SKILL.md` step 4, delivered by PR #58.
- This record supersedes the summary-body and numbering clauses (ACs 1–3) of the done record `docs/stories/2026-08-20-post-review-findings-as-anchored-pr-comments.md`; that record stays as-is per the lifecycle.

## Priority

Medium — every review pass posts this comment, and the current format buries the blockers it exists to surface.
