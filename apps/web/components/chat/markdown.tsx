"use client";

/**
 * The chat markdown renderer (story #134 task #135 commit 5, AC 5).
 *
 * Assistant and user text renders as markdown (headings, lists, links,
 * inline code, fenced blocks, GFM tables/task-lists) with SANITIZED output:
 * rehype-sanitize runs the default safe schema over the parsed tree before
 * any HTML exists, so model-produced markup can never inject.
 *
 * The streaming discipline is AC 5's open-fence rule: while a bubble
 * streams, its content is re-parsed every delta; an UNTERMINATED trailing
 * fence must not render as an empty code block mid-type, and highlighting
 * it per-delta would thrash Shiki. So the text is split at the last fence
 * marker when the fence count is odd: everything before it is markdown
 * (closed fences highlight), the open tail renders as plain monospace and
 * re-joins the markdown side once the provider closes it.
 */
import { createContext, useContext, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Components } from "react-markdown";

import { CodeBlock } from "@/components/chat/shiki-code";

/** Split content at an odd (open) trailing fence: [markdown, plain-tail]. */
export function splitOpenFence(text: string): { markdown: string; openTail: string } {
  const markers = text.split("```").length - 1;
  if (markers % 2 === 0) return { markdown: text, openTail: "" };
  const last = text.lastIndexOf("```");
  return { markdown: text.slice(0, last), openTail: text.slice(last + 3).replace(/^\w*\n/, "") };
}

/** react-markdown gives `code` no block/inline fact; the `pre` wrapper is
 * the block signal, carried through context. */
const InPre = createContext(false);

const components: Components = {
  // The block renderer is `code` (it knows the language); `pre` passes its
  // single child through so CodeBlock owns the frame (no nested <pre>).
  pre: ({ children }) => <InPre.Provider value={true}>{children}</InPre.Provider>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  // react-markdown invokes this AS a component, so the hook reads the
  // pre-wrapper context directly (no inner component identity per render).
  code: ({ className, children }) => {
    const inPre = useContext(InPre);
    const match = /language-([\w-]+)/.exec(String(className ?? ""));
    const raw = String(children ?? "").replace(/\n$/, "");
    if (inPre) return <CodeBlock code={raw} lang={match?.[1] ?? "text"} />;
    return <code className="bg-muted px-1 py-0.5 font-mono text-[0.85em]">{raw}</code>;
  },
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
};

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { markdown, openTail } = useMemo(
    () => (streaming ? splitOpenFence(text) : { markdown: text, openTail: "" }),
    [text, streaming],
  );
  return (
    <div className="md-body text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
      {openTail !== "" && (
        <pre className="my-2 overflow-x-auto rounded-none bg-muted/60 p-3 font-mono text-xs whitespace-pre">
          {openTail}
        </pre>
      )}
    </div>
  );
}
