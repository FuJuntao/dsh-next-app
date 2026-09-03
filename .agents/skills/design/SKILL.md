---
name: design
description: Design the experience of one story - actor and job, flow, first-screen hierarchy, state coverage, interface copy, visual direction - interview until no judgment is silently assumed, then write the design packet into the parent issue. There is no product designer on this repo; this skill is the designer. Invoked by command only.
disable-model-invocation: true
---

# Design the experience of a story

You are loaded when the user types `/design` followed by a story (parent) issue number or URL (e.g. `/design 97`). Run it between `/story` and `/implement-a-task` for any story whose acceptance criteria touch the user interface; a story nobody designs is a story whose UX gets invented under implementation pressure. Produce exactly ONE design per invocation, in English, and end by writing the design packet into the parent issue as a `## Design` section. Commit no repo files and push nothing - the issue is the source of truth (ADR-0005).

## 1. Gather context
Before asking anything, read:
- The parent issue - story sentence, acceptance criteria, Non-Goals, Tasks checklist - and its task sub-issues.
- ADRs relevant to the change.
- The app's current surfaces: `apps/web` routes and components, `app/globals.css` tokens - so the design derives from the system that exists, not one imagined.
- The locked `frontend-design` skill (`.agents/skills/frontend-design/`) as reference for the visual layer, and this repo's `shadcn` skill rules as the binding floor for components and tokens.
Never invent needs or constraints the context does not contain.

## 2. Settle intent before visuals
Answer each of these explicitly; every one the story leaves silent becomes an interview question:
- **Actor and job**: who uses this surface, and what are they trying to get done? The design serves one stated job; a screen without a job has no design yet.
- **Primary flow**: entry point, the steps to job completion, and what each step consumes and produces.
- **First-screen hierarchy**: what the first viewport shows without any interaction, and the one action that matters there.
- **Frequency and density**: used daily calls for quiet, dense, scannable; occasional calls for forgiving surfaces with signposts.
- **Failure**: what realistically goes wrong, and how the interface says so and shows the way back.

## 3. Cover the states
Every meaningful screen and component in scope gets its behavior defined in the packet, wherever it applies: default, loading, empty, error, success or disabled, long content, narrow viewport, keyboard focus, reduced motion. Empty states invite the next action; errors state what happened and how to fix it; nothing fakes liveness or status the system does not have. A state not asked for here is a state invented badly in code later.

## 4. Treat copy as design material
Pin the vocabulary in the packet: things are named by what the user controls, never by how the system is built; controls use active voice and say what happens when used; one action keeps the same name through the whole flow.

## 5. Choose the visual direction
Derive it from the intent, bounded by the existing system: semantic tokens before raw values, existing components before custom markup, one deliberate memorable element at most - the rest stays disciplined. If the design needs a new token, font role, or radius, name it and where it lands in `globals.css`. Consult the `frontend-design` skill to keep the result specific to this product rather than a templated default; when intent and prettiness conflict, intent wins.

## 6. Grill in rounds
Grill every unsettled judgment in batched rounds until nothing vague remains; never settle after a single round. Each round, ask every question whose prerequisites are already settled - together, numbered, each with a recommended answer - then revise the packet. Hold only questions that depend on answers still outstanding. Probe state coverage and first-screen hierarchy hardest. Exit only when the packet has no unresolved item and the user confirms. Anything genuinely unanswerable yet goes into `## Open design questions` in the packet - never silently dropped, never invented. No fixed round cap.

## 7. Preview (repeat until Write, Edit, or Cancel)
Show the complete packet and ask:
- **Write** - replace the parent issue's `## Design` section with the packet. On re-runs, replace the previous section in full; never append a second one.
- **Edit** - free-text changes; apply and preview again. Edits touching intent, states, or copy re-run the relevant probe in one targeted round first.
- **Cancel** - change nothing on the issue; confirm the cancellation.

Packet shape (a `## Design` section in the parent issue body, placed before `## Tasks`):

```markdown
## Design
### Intent
### Flow
### States
### Copy
### Visual direction
### Open design questions
```

## 8. Report
Summarize the packet as written, link the parent issue, and point to the next stage: `implement-a-task` builds to it and the `review` skill's UI axis checks against it.
