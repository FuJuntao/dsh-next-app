# Story records

Stories for planning work in this repo, newest first. See [../adr/](../adr/) for architecture decisions.

## Status vocabulary

A story record moves through exactly these statuses, in order:

| Status    | Meaning                                              | Set by                                       |
|-----------|------------------------------------------------------|----------------------------------------------|
| Proposed  | Story recorded; not yet planned into tasks           | the `story` skill (`/story`)              |
| Planned   | Tasks broken down; GitHub issue and sub-issues exist | the `plan-a-story` skill (`/plan-a-story`) |
| Done      | All task issues closed; the work is complete         | manually, when the story's issues close      |

The `story` and `plan-a-story` skills use only these values.

## Stories

(records appear here as they are created)

Entries: `- [<Title>](./<file>) — <Status>` (`— #<parent>` once planned).
