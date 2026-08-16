---
name: story
description: Create one user story for planning work in the current repo — interview the user, file the story as a GitHub issue, and keep a repo record under docs/stories/. Invoked by command only.
disable-model-invocation: true
---

# Create a planning story

You are loaded when the user types `/story`, optionally followed by a rough idea that seeds the interview (e.g. `/story implement dark mode`). Produce exactly ONE user story per invocation, written in English, filed in two places: a GitHub issue and a repo record under `docs/stories/`. Do not push anything.

## 1. Resolve the target repo
- Derive the GitHub owner/repo from the repository the session is working in: `git remote get-url origin`, accepting `https://github.com/<owner>/<repo>.git` and `git@github.com:<owner>/<repo>.git`.
- If there is no GitHub remote, stop and tell the user; create nothing.

## 2. Interview (one structured round)
Ask a single round with the `ask_user_question` tool, pre-filling anything the seed already contains:
1. Actor — "As a …" (who wants this)
2. Capability — "I want …" (what they want)
3. Benefit — "so that …" (why it matters)
4. Acceptance criteria — at least one item; accept several
5. Technical notes — optional
6. Priority — optional, free text
7. Label — optional; default `enhancement`
If any answer is vague or contradictory, ask one focused follow-up round. Never invent answers.

## 3. Compose the story
- Title: a short imperative phrase derived from the capability (e.g. "Add dark mode"), at most 72 characters.
- Issue body, in English:

```
As a <actor>, I want <capability>, so that <benefit>.

## Acceptance Criteria
- [ ] …

## Technical Notes
…                     (omit this section when no notes were given)

## Priority
…                     (omit this section when no priority was given)

**Story record:** docs/stories/<date>-<slug>.md
```

- Fix the record path now: `docs/stories/<YYYY-MM-DD>-<slug>.md`, slug kebab-cased from the title. If that path already exists, append `-2`, `-3`, … until free.

## 4. Preview loop (repeat until Create or Cancel)
Every round, show the complete issue — title, body, labels — and ask with structured options:
- **Create now** — proceed to step 5.
- **Edit** — a free-text field for changes; apply them, re-derive the title/slug if the capability changed, and show the preview again.
- **Cancel** — create nothing and write nothing; confirm the cancellation.
Never create the issue until the user picks Create now.

## 5. Create the GitHub issue
Use the first mechanism that works, in order:
1. `gh` CLI, when `gh auth status` succeeds:
   `gh issue create -R <owner>/<repo> --title "<title>" --body-file <tmpfile> --label <label>`
2. The GitHub REST API, when `GITHUB_TOKEN` or `GH_TOKEN` is set:
   `curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" https://api.github.com/repos/<owner>/<repo>/issues -d @<jsonfile>` with `{"title": …, "body": …, "labels": [<label>]}`.
3. Manual creation: write the repo record (step 6) with `Issue: not yet created`, then print the full title/body/labels and the exact `gh issue create` command for the user to run; state clearly that the issue was not created.
If a mechanism fails (network, permissions, unauthenticated), fall through to the next one; if every mechanism fails, use manual creation. If the user requested a label that does not exist, ask whether to create it (`gh label create …`) or fall back to `enhancement`. Never print secrets.

## 6. Write the repo record (always — including manual creation)
- Create `docs/stories/` if it does not exist, then write the record with an ADR-style header:

```
# <Title>

- Date: <YYYY-MM-DD>
- Status: Proposed
- Issue: <issue URL, or "not yet created">
```

followed by the story sentence, Acceptance Criteria, Technical Notes, and Priority.
- Keep the index `docs/stories/README.md` current: a bullet list, newest first, of `- [<Title>](./<file>) — #<number> / <status>`.

## 7. Commit the record (never push)
- If the current branch is not `main` or `master`: `git add` the record (and the index if it changed) and commit with `docs(story): add <title>`, following the session's commit conventions (Conventional Commits, including the Co-authored-by trailer those instructions require).
- If on `main` or `master`: do not commit; report the uncommitted path and let the user commit.

## 8. Report
Summarize: the issue URL and number (or the manual-fallback status), the story record path, the commit hash if one was made, and anything left uncommitted.
