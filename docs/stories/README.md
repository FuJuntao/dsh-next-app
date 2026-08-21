# Story records

Stories for planning work in this repo, newest first. See [../adr/](../adr/) for architecture decisions.

## Lifecycle

Story records carry no status field. The lifecycle is tracked by what exists outside the record:

1. **Proposed** - the record exists (created by the `story` skill, `/story`).
2. **Planned** - an open GitHub issue references this record (`**Story record:** docs/stories/<file>`); the `plan-a-story` skill (`/plan-a-story`) creates that issue and its task sub-issues.
3. **In flight** - the `implement-a-task` skill (`/implement-a-task`) carries each task sub-issue from its issue to a reviewable pull request. Task issues close and the parent checklist ticks automatically as PRs merge.
4. **Done** - the merged pull request is linked: add a `- PR: <merged PR URL>` line to the record header and strike the index entry below. The `bookkeeping` skill (`/bookkeeping`) performs this step, together with closing the parent issue and keeping task checklists truthful.

## Stories

- [Keep the review verdict summary focused on findings](./2026-08-21-keep-the-review-verdict-summary-focused-on-findings.md)
- [Implement the bundle runtime glue](./2026-08-20-implement-the-bundle-runtime-glue.md)
- ~~[Post review findings as anchored PR comments](./2026-08-20-post-review-findings-as-anchored-pr-comments.md)~~
- ~~[Add a typed dsh-api client with SSE downlinks](./2026-08-19-add-a-typed-dsh-api-client-with-sse-downlinks.md)~~
- ~~[Scaffold the pnpm workspace for real code](./2026-08-18-scaffold-the-pnpm-workspace-for-real-code.md)~~
- ~~[Add review and bookkeeping skills plus a contributor doc](./2026-08-18-add-review-and-bookkeeping-skills-plus-a-contributor-doc.md)~~
- ~~[Make planning skills interview in rounds until nothing is vague](./2026-08-17-make-planning-skills-interview-in-rounds-until-nothing-is-vague.md)~~
- ~~[Add an implement-a-task skill](./2026-08-17-add-an-implement-a-task-skill.md)~~

Entries: `- [<Title>](./<file>)`
