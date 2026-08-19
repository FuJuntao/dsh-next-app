import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AC 1 guard: dsh-host-apiproxy is the only upstream runtime dependency.
 * Scans the built dist/ and asserts every @deepseek-ai/* runtime import
 * belongs to exactly that one package - silently gaining another host
 * package here would fork the version lock ADR-0006/ADR-0008 maintain.
 */

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));

/** ESM import/export-from/dynamic-import specifiers in emitted code. */
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/gu;

async function listBuiltModules(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(distDir, { recursive: true });
  } catch (error) {
    throw new Error("packages/dsh-api/dist is missing - run 'pnpm build' before 'pnpm test'.", {
      cause: error,
    });
  }
  const modules = entries
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => path.join(distDir, entry));
  if (modules.length === 0) {
    throw new Error(
      "packages/dsh-api/dist holds no .js modules - run 'pnpm build' before 'pnpm test'.",
    );
  }
  return modules;
}

function deepseekPackageName(specifier: string): string | undefined {
  if (!specifier.startsWith("@deepseek-ai/")) return undefined;
  const [scope, name] = specifier.split("/");
  return scope + "/" + (name ?? "");
}

describe("built-output runtime imports", () => {
  it("uses exactly @deepseek-ai/dsh-host-apiproxy among @deepseek-ai/* packages", async () => {
    const used = new Set<string>();
    for (const modulePath of await listBuiltModules()) {
      const source = await readFile(modulePath, "utf8");
      for (const match of source.matchAll(IMPORT_SPECIFIER)) {
        const packageName = deepseekPackageName(match[1] ?? "");
        if (packageName !== undefined) used.add(packageName);
      }
    }
    expect([...used].sort()).toStrictEqual(["@deepseek-ai/dsh-host-apiproxy"]);
  });
});
