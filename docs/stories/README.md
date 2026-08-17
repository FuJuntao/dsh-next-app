# Story records

Stories for planning work in this repo, newest first. See [../adr/](../adr/) for architecture decisions.

## Lifecycle

Story records carry no status field. The lifecycle is tracked by what exists outside the record:

1. **Proposed** — the record exists (created by the `story` skill, `/story`).
2. **Planned** — an open GitHub issue references this record (`**Story record:** docs/stories/<file>`); the `plan-a-story` skill (`/plan-a-story`) creates that issue and its task sub-issues.
3. **Done** — the merged pull request is linked: add a `- PR: <merged PR URL>` line to the record header and strike the index entry below. This is done manually for now — no skill performs it yet.

## Stories

- [Add an implement-a-task skill](./2026-08-17-add-an-implement-a-task-skill.md)

Entries: `- [<Title>](./<file>)`