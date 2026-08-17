# Story records

Stories for planning work in this repo, newest first. See [../adr/](../adr/) for architecture decisions.

## Lifecycle

Story records carry no status field. The lifecycle is tracked by what exists outside the record:

1. **Proposed** — the record exists (created by the `story` skill, `/story`).
2. **Planned** — an open GitHub issue references this record (`**Story record:** docs/stories/<file>`); the `plan-a-story` skill (`/plan-a-story`) creates that issue and its task sub-issues.
3. **In flight** — the `implement-a-task` skill (`/implement-a-task`) carries each task sub-issue from its issue to a reviewable pull request. Task issues close and the parent checklist ticks automatically as PRs merge.
4. **Done** — the merged pull request is linked: add a `- PR: <merged PR URL>` line to the record header and strike the index entry below. This is done manually for now — no skill performs it yet.

## Stories

- [Add review and bookkeeping skills plus a contributor doc](./2026-08-18-add-review-and-bookkeeping-skills-plus-a-contributor-doc.md)
- ~~[Make planning skills interview in rounds until nothing is vague](./2026-08-17-make-planning-skills-interview-in-rounds-until-nothing-is-vague.md)~~
- [Add an implement-a-task skill](./2026-08-17-add-an-implement-a-task-skill.md)

Entries: `- [<Title>](./<file>)`