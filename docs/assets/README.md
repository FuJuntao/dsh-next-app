# docs/assets

UI captures attached to pull-request bodies. One directory per story
(`149/`), PNGs only.

- **Purpose:** a PR body embeds these to show reviewers the rendered
  state a diff produces; they are review artifacts, not documentation
  prose, and nothing in `main` links them by path.
- **Truth rule (review #2):** a capture is only ever referenced by
  commit-SHA-pinned URLs (`.../raw/<sha>/docs/assets/...`) written at
  PR time, so a merge or branch delete can never break the body that
  cites it. They restate a moment of UI state - the e2e legs, not the
  PNGs, are what CI keeps truthful.
- **Who refreshes:** the PR author, during review, when the reviewed UI
  changes - re-capture and re-pin in the same push; do not accumulate
  restyled duplicates of the same story folder.
