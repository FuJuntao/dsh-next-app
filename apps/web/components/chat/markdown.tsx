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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

// The document rhythm the .md-body rules used to carry in globals.css, now
// inline on the elements themselves: every element styles itself, and the
// wrapper trims the first/last margins the CSS selected for.
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
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1 text-[1.15em] font-semibold leading-snug">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1 text-[1.1em] font-semibold leading-snug">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-3 mb-1 font-semibold leading-snug">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 font-semibold leading-snug">{children}</h4>,
  p: ({ children }) => <p className="my-2">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc ps-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal ps-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  // A rule between markdown blocks is a Separator (no <hr> hand-styling).
  hr: () => <Separator className="my-3" />,
  // Tables are the standard Table primitives - their container brings the
  // overflow scroll the old inline wrapper carried.
  table: ({ children }) => <Table className="my-2">{children}</Table>,
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableHead>{children}</TableHead>,
  td: ({ children }) => <TableCell>{children}</TableCell>,
};

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { markdown, openTail } = useMemo(
    () => (streaming ? splitOpenFence(text) : { markdown: text, openTail: "" }),
    [text, streaming],
  );
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
      {openTail !== "" && (
        <pre className="my-2 overflow-x-auto rounded-md bg-muted/60 p-3 font-mono text-xs whitespace-pre">
          {openTail}
        </pre>
      )}
    </div>
  );
}
