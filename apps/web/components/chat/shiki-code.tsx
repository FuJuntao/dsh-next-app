"use client";

/**
 * Fenced-code highlighting with lazily loaded Shiki (story #134 task #135
 * commit 5, AC 5).
 *
 * Nothing about this runs before it is needed: the shiki package (core,
 * engine, grammar, and theme bundles) loads per code block on mount via a
 * shared dynamic-import singleton, and an un-highlighted block renders as
 * plain monospace the whole time - first paint is never blocked by it.
 *
 * Static dual-theme CSS is the Next.js-recommended posture: `codeToHtml`
 * with `defaultColor: false` emits spans whose colors read
 * `--shiki-light`/`--shiki-dark` variables, and the globals.css dark rule
 * (driven by the existing `.dark` variant) swaps them with no JS theme
 * awareness and no re-highlight on toggle. An unknown language degrades to
 * plain text instead of failing the block.
 */
import { useEffect, useState } from "react";
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki";

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

let highlighterPromise: Promise<Highlighter> | null = null;

/** The single lazily-built highlighter for the whole client bundle. */
function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= import("shiki")
    .then(({ createHighlighter }) =>
      createHighlighter({ themes: ["github-light", "github-dark"], langs: [] }),
    )
    .catch((error: unknown) => {
      highlighterPromise = null; // a failed load may be retried by the next block
      throw error;
    });
  return highlighterPromise;
}

const SAFE = /^language-[\w+-]*$/;

/** Escape a class-less HTML-free fallback render. */
function Plain({ code }: { code: string }) {
  return (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs whitespace-pre">
      {code}
    </pre>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const highlighter = await getHighlighter();
        let language = lang === "" || lang === "text" ? "plaintext" : lang;
        if (!SAFE.test(`language-${language}`)) language = "plaintext";
        try {
          await highlighter.loadLanguage(language as Parameters<Highlighter["loadLanguage"]>[0]);
        } catch {
          language = "plaintext"; // an ungrammared fence still shows its text
        }
        if (!alive) return;
        const next = highlighter.codeToHtml(code, {
          lang: language,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          structure: "classic",
        });
        setHtml(next);
      } catch (error) {
        if (alive) {
          console.error("[shiki] highlight failed:", error);
          setFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, lang]);

  if (failed || html === null) return <Plain code={code} />;
  return (
    <div
      className="my-2 overflow-x-auto rounded-md text-xs [&>pre]:m-0 [&>pre]:bg-transparent [&>pre]:p-3"
      // Shiki's own generated markup (spans with color variables) - no
      // model content survives into this string: it is produced from the
      // code text through the tokenizer.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
