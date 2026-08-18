# Add review and bookkeeping skills plus a contributor doc

- Date: 2026-08-18

As a contributor, I want a review skill that reviews an open pull request along explicit axes and a bookkeeping skill that finishes work after merge - plus a contributor doc holding the standing context - so that work truly finishes when its PR merges, the repo's records stay truthful, and I need no conversation memory to contribute.

## Acceptance Criteria

1. `/review` is user-invoked by command with a PR number/URL as its argument (fallback: list open PRs and let the user pick); `disable-model-invocation: true`; it ships as `.agents/skills/review/SKILL.md` with the family frontmatter.
2. Before reviewing, it gathers context: the PR (diff, body, commits), its task and parent issues including the AC checkpoint, the linked story record under `docs/stories/`, relevant ADRs, and whatever contributor conventions (AGENTS.md or equivalent) apply in the environment it runs in.
3. The review runs per axis, each axis stating its applicability rule, and the verdict lists which axes ran:
   - **Spec** - the diff satisfies the task's AC checkpoint and the linked story record.
   - **System design** - repo-wide constraints: ADR compliance, workspace boundaries, API shape. Spec blockers trace to task ACs and the story; system-design blockers trace to ADRs - a PR that satisfies its task yet violates an ADR fails here.
   - **Repo standards** - the change meets the repo's stated standards beyond the ADRs: its contributor doc (AGENTS.md or equivalent), the README's user-facing commitments, and any other convention the repo states. Blockers trace to the statement violated.
   - **UI** - only when the diff touches UI code: the built app is exercised with the `agent-browser` skill against the PR's changes.
   - **Security** - no secrets or leaked personal data; public-repo hygiene per ADR-0005.
   - **Docs discipline** - doc changes ship together with the implying change, ADRs stay frozen, task lists stay truthful (ADR-0005).
   - **Verification claims** - the PR body states what was run; the reviewer re-runs it or checks its plausibility.
   - **Commit hygiene** - the commit conventions stated by the environment it runs in.
4. The verdict is structured: approve, or request-changes with numbered, axis-tagged blockers, each traceable to its source (task AC, ADR, convention) - never a rubber stamp.
5. Merge is gated: `/review` merges only on an explicit per-PR go-ahead, never pushes to `main` directly, and points to `/bookkeeping` for the post-merge tail.
6. `/bookkeeping` is user-invoked by command, `disable-model-invocation: true`, ships as `.agents/skills/bookkeeping/SKILL.md`. Its optional argument names a starting point - a PR (number/URL), a commit hash, or a branch - which is resolved to a git hash, checked out, and fully checked; with no argument or an unresolvable one it proposes running on `main` and waits for confirmation. A stale or conflicting checked-out state triggers a user choice: update the starting point first, or proceed with the latest info - the records side always comes from one explicitly chosen state. The check always covers the whole repo.
7. It owns: closing parent issues whose checklists are complete; ticking/unticking parent checklist lines to match reality; the story-record Done step (add the `- PR: <merged URL>` line to the record header, strike the `docs/stories/README.md` index entry); and confirming task issues actually closed. Every intended repair is shown as one itemized preview and applied only after a single go-ahead.
8. The drift sweep is exercisable on the repo as it stands: it reports and - on approval - fixes open parent issues whose sub-issues are all complete with PRs merged (today: #4 and #7) and story records done but unmarked.
9. It resolves the implement-a-task story's Open Question: record freshness belongs to `/bookkeeping`; `story`, `plan-a-story`, and `implement-a-task` never edit records or issues post-merge. The `docs/stories/README.md` lifecycle line saying the Done step is manual ("no skill performs it yet") is updated accordingly.
10. The contributor doc ships as root `AGENTS.md` - repo map, workflow lifecycle from story to done, where decisions and plans live (ADRs, story records, issues), and the verification status stated truthfully ("none defined yet" until code lands) - plus a one-line `CONTRIBUTING.md` pointing to it.
11. `agent-browser` is tracked in root `skills-lock.json` as an externally sourced skill, in the same format as the existing `grilling` entry.
12. Both skills are runtime-agnostic: they reference conventions and repo records, never restate environment-specific rules.

## Non-Goals

- Creating stories or plans (`story`, `plan-a-story`) and implementing tasks (`implement-a-task`).
- Creating CI pipelines or tests: dsh-compat enforcement stays mechanical - contract tests, the boot invariant, future CI (ADR-0006, ADR-0008) - not a review axis.
- Auto-merging PRs, managing CI, or deploying.
- Changing the story-record format or the plan-a-story issue structure.
- Touching the `grilling` skill.

## Technical Notes

- New files: `.agents/skills/review/SKILL.md`, `.agents/skills/bookkeeping/SKILL.md`, `AGENTS.md`, `CONTRIBUTING.md`. Edited files: root `skills-lock.json` (add the `agent-browser` entry in grilling's format), `docs/stories/README.md` (lifecycle line).
- The repo is docs-only today; axes without current applicability (UI) state their applicability rule rather than being dropped.

## Priority

High - live drift already exists (open #4 and #7 with all sub-issues complete and PRs merged), every merged PR adds more, and the skill family currently ends at "the PR is open", leaving the tail entirely manual.
