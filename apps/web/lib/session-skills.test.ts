/**
 * The session door's own failures (story #152 task #153 commit 5). AC 5 and
 * AC 6 are claims about what happens when the roster cannot be read, and the
 * half of them that lives here - report, do not fold - is what these cases
 * pin. The menu's other half (what a reported failure RENDERS: the vendored
 * commands plus one hint line) is pinned in slash-menu.test.ts, where the
 * merge rule lives; the bridge is the only thing mocked here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillEntry } from "@deepseek-ai/dsh-host-apiproxy/api";

const fake = vi.hoisted(() => ({ skills: { list: vi.fn() } }));

vi.mock("./bridge", () => ({
  getActionBridgeClient: () => fake,
}));

const { fetchSessionSkills } = await import("./session-skills");

/** One ok envelope carrying these rows. */
function listed(skills: Partial<SkillEntry>[]): {
  result: { ok: true; value: { skills: Partial<SkillEntry>[] } };
} {
  return { result: { ok: true, value: { skills } } };
}

/** One business failure, in the shape the carrier answers with. */
function refused(
  code: string,
  message = "no such session",
): {
  result: { ok: false; error: { code: string; message: string; details: unknown } };
} {
  return { result: { ok: false, error: { code, message, details: {} } } };
}

const row = (name: string, description = name + " says what it does"): Partial<SkillEntry> => ({
  name,
  description,
  modelInvocable: true,
});

beforeEach(() => {
  fake.skills.list.mockReset();
});

describe("fetchSessionSkills", () => {
  it("asks the host by session id, and never by a path", async () => {
    fake.skills.list.mockResolvedValue(listed([]));
    await fetchSessionSkills("session-42");
    expect(fake.skills.list).toHaveBeenCalledWith({ sessionId: "session-42" });
  });

  it("keeps the host's rows and the host's order", async () => {
    // AC 1's order promise depends on this door not sorting and not filtering:
    // the host ranked these by root, and the menu shows them that way.
    fake.skills.list.mockResolvedValue(
      listed([row("zulu"), row("alpha"), row("command-only", "invoked by command")]),
    );
    const result = await fetchSessionSkills("session-1");
    if (!result.ok) throw new Error("expected the roster");
    expect(result.skills.map((one) => one.name)).toEqual(["zulu", "alpha", "command-only"]);
  });

  it("carries the host's description verbatim, whenToUse aside", async () => {
    fake.skills.list.mockResolvedValue(
      listed([{ name: "folded", description: "Deploy the stack\n", whenToUse: "only on request" }]),
    );
    const result = await fetchSessionSkills("session-1");
    if (!result.ok) throw new Error("expected the roster");
    expect(result.skills).toEqual([{ name: "folded", description: "Deploy the stack\n" }]);
  });

  it("keeps a skill the model may not invoke", async () => {
    // The command-only family is exactly what a user types into `/`.
    fake.skills.list.mockResolvedValue(listed([{ ...row("story"), modelInvocable: false }]));
    const result = await fetchSessionSkills("session-1");
    if (!result.ok) throw new Error("expected the roster");
    expect(result.skills.map((one) => one.name)).toEqual(["story"]);
  });

  it("answers an empty roster as ok, because that is an answer", async () => {
    fake.skills.list.mockResolvedValue(listed([]));
    expect(await fetchSessionSkills("session-1")).toEqual({ ok: true, skills: [] });
  });

  it("reports a refusal with its code, and does not fold it to empty", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.skills.list.mockResolvedValue(refused("session-not-found"));
    const result = await fetchSessionSkills("does-not-exist");
    expect(result).toEqual({ ok: false, reason: "skill.list refused: session-not-found" });
    expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "skill.list failed: session-not-found",
    );
    warn.mockRestore();
  });

  it("reports a bridge that cannot be reached as a refusal", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fake.skills.list.mockRejectedValue(new Error("cannot reach the dsh bridge: ECONNREFUSED"));
    const result = await fetchSessionSkills("session-1");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toContain("cannot reach the dsh bridge");
    warn.mockRestore();
  });
});
