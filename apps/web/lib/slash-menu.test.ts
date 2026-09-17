/**
 * The `/` menu merge rule (story #152 task #153 commit 1): what #152's AC 1
 * and AC 3 promise, pinned where it is actually implemented.
 *
 * AC 1 is an ORDER claim ("skills before the vendored commands", "the host's
 * root-rank order", "registration order"), and an order claim cannot be
 * checked by looking at one row - so each case here asserts the whole
 * sequence, not membership. AC 3 is a CLAMP claim shared by both surfaces,
 * pinned here once so neither door can hold a private version of it.
 */
import { describe, expect, it } from "vitest";
import {
  buildSlashMenu,
  clampSkillDescription,
  slashMenuFrom,
  type SlashMenuSkill,
} from "./slash-menu";
import { SLASH_MENU_ENTRIES, VENDORED_SLASH_COMMANDS } from "./slash-commands";

const skill = (name: string, description = name + " description"): SlashMenuSkill => ({
  name,
  description,
});

/** The labels buildSlashMenu produced, in order. */
const labels = (skills: SlashMenuSkill[]): string[] =>
  buildSlashMenu(skills).map((entry) => entry.label);

describe("buildSlashMenu", () => {
  it("puts every skill before every vendored command", () => {
    const entries = buildSlashMenu([skill("story"), skill("design")]);
    expect(entries.slice(0, 2).map((e) => e.label)).toEqual(["/story", "/design"]);
    expect(entries.slice(2).every((e) => e.kind === "command")).toBe(true);
    expect(entries.slice(2).map((e) => e.label)).toEqual(
      VENDORED_SLASH_COMMANDS.map((c) => "/" + c.name),
    );
  });

  it("keeps the incoming skill order - no sort invented", () => {
    // The session door hands over skill.list's rows verbatim; the host ranks
    // them by root, and re-sorting here would silently overrule that ranking.
    expect(labels([skill("zulu"), skill("alpha"), skill("mike")])).toEqual([
      "/zulu",
      "/alpha",
      "/mike",
      ...VENDORED_SLASH_COMMANDS.map((c) => "/" + c.name),
    ]);
  });

  it("keeps the vendored commands in registration order after the skills", () => {
    const tail = labels([skill("story")]).slice(1);
    expect(tail).toEqual(VENDORED_SLASH_COMMANDS.map((command) => "/" + command.name));
  });

  it("lets a skill that shadows a command name win", () => {
    const entries = buildSlashMenu([skill("compact", "this project's own compact")]);
    expect(entries[0]).toMatchObject({
      label: "/compact",
      description: "this project's own compact",
      key: "skill:compact",
    });
    // Exactly one /compact row: the vendored one is gone, not duplicated.
    expect(entries.filter((entry) => entry.label === "/compact")).toHaveLength(1);
    // The rest of the remainder is untouched, in order.
    expect(entries.slice(1).map((entry) => entry.label)).toEqual(
      VENDORED_SLASH_COMMANDS.filter((c) => c.name !== "compact").map((c) => "/" + c.name),
    );
  });

  it("clamps a skill's second line but never a vendored description", () => {
    const long = "x".repeat(400);
    const entries = buildSlashMenu([skill("film-find", long)]);
    expect(entries[0]?.description).toBe("x".repeat(159) + "…");
    // The vendored list is the registry's own text, copied verbatim (with the
    // command's input hint appended): the menu has no licence to rewrite it.
    expect(entries.slice(1).map((entry) => entry.description)).toEqual(
      SLASH_MENU_ENTRIES.map((entry) => entry.description),
    );
  });

  it("offers the full vendored list when the project has no skills", () => {
    // AC 5's degraded floor: an empty roster costs nothing but the skill rows.
    expect(labels([])).toEqual(VENDORED_SLASH_COMMANDS.map((command) => "/" + command.name));
  });

  it("keys skill rows apart from command rows", () => {
    // The typeahead keys options to keep identity stable across re-renders;
    // a skill named like a command must not collide with the vendored row.
    const [row] = buildSlashMenu([skill("plan")]);
    expect(row?.key).toBe("skill:plan");
  });
});

describe("clampSkillDescription", () => {
  it("leaves a short description alone", () => {
    expect(clampSkillDescription("one line")).toBe("one line");
    expect(clampSkillDescription("")).toBe("");
  });

  it("cuts at 160 characters total, ellipsis included", () => {
    const at = "a".repeat(160);
    const over = "a".repeat(161);
    expect(clampSkillDescription(at)).toBe(at);
    expect(clampSkillDescription(over)).toBe("a".repeat(159) + "…");
    expect(clampSkillDescription(over)).toHaveLength(160);
  });

  it("is idempotent, so the parity guard can clamp twice", () => {
    const once = clampSkillDescription("y".repeat(500));
    expect(clampSkillDescription(once)).toBe(once);
  });
});

describe("slashMenuFrom", () => {
  const HINT = "Couldn't read this folder's skills";
  const six = VENDORED_SLASH_COMMANDS.map((command) => "/" + command.name);

  it("renders an answered roster as itself, and says nothing", () => {
    const menu = slashMenuFrom({ ok: true, skills: [skill("story")] }, HINT);
    expect(menu.entries.map((entry) => entry.label)).toEqual(["/story", ...six]);
    expect(menu.hint).toBeUndefined();
  });

  it("treats an empty answer as an answer: no hint, full floor", () => {
    // AC 6's "this project has no skills" half, which must not borrow the
    // failure's wording - the menu is telling the truth about the project.
    const menu = slashMenuFrom({ ok: true, skills: [] }, HINT);
    expect(menu.entries.map((entry) => entry.label)).toEqual(six);
    expect(menu.hint).toBeUndefined();
  });

  it("keeps the floor and adds the line when the read was refused", () => {
    // AC 5 and AC 6 in one breath: the menu never goes empty, and an unknown
    // roster is never presented as an absent one.
    const menu = slashMenuFrom({ ok: false, reason: "cannot list /x/.agents/skills" }, HINT);
    expect(menu.entries.map((entry) => entry.label)).toEqual(six);
    expect(menu.entries.map((entry) => entry.description)).toEqual(
      SLASH_MENU_ENTRIES.map((entry) => entry.description),
    );
    expect(menu.hint).toBe(HINT);
  });

  it("carries the door's own copy, because only the door knows the noun", () => {
    expect(slashMenuFrom({ ok: false, reason: "x" }, HINT).hint).toBe(HINT);
    expect(
      slashMenuFrom({ ok: false, reason: "x" }, "Couldn't read this session's skills").hint,
    ).toBe("Couldn't read this session's skills");
  });
});
