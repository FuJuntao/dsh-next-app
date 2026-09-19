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
 * Dual theming is two single-theme renders instead of shiki's static
 * dual-theme variables: each `codeToHtml` call bakes final inline colors for
 * its theme (no `--shiki-*` variables, so no span-mapping rules in
 * globals.css), and the pair toggles through Tailwind's own `dark:` variant
 * - the same `.dark` trigger the CSS rule used, with zero custom CSS. A
 * transformer strips each pre's inline frame style so the wrapper's muted
 * surface (the `bg-muted` token inline code uses) is the block's background.
 * An unknown language degrades to plain text instead of failing the block.
 */
import { useEffect, useState } from "react";
import type { BundledLanguage, BundledTheme, HighlighterGeneric, ShikiTransformer } from "shiki";

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

/** Drop the theme's own pre frame (inline background/color) - the wrapper
 * owns the surface, per the token rule. */
const stripPreFrame: ShikiTransformer = {
  name: "strip-pre-frame",
  pre(node) {
    node.properties.style = undefined;
  },
};

const SAFE = /^language-[\w+-]*$/;

/** The block frame both the highlighted and fallback renders share. */
const FRAME =
  "my-2 overflow-x-auto rounded-md bg-muted/60 text-xs [&>pre]:m-0 [&>pre]:bg-transparent [&>pre]:p-3";

/** Escape a class-less HTML-free fallback render. */
function Plain({ code }: { code: string }) {
  return (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs whitespace-pre">
      {code}
    </pre>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<{ light: string; dark: string } | null>(null);
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
        const render = (theme: "github-light" | "github-dark") =>
          highlighter.codeToHtml(code, {
            lang: language,
            theme,
            structure: "classic",
            transformers: [stripPreFrame],
          });
        setHtml({ light: render("github-light"), dark: render("github-dark") });
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
    <>
      {/* Shiki's own generated markup (spans with inline theme colors) - no
          model content survives into these strings: they are produced from
          the code text through the tokenizer. */}
      <div className={FRAME + " dark:hidden"} dangerouslySetInnerHTML={{ __html: html.light }} />
      <div
        className={FRAME + " hidden dark:block"}
        dangerouslySetInnerHTML={{ __html: html.dark }}
      />
    </>
  );
}
