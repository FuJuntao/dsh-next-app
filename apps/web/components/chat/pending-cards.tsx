"use client";

/**
 * Answerable tail cards (story #134 task #135 commit 8; AC 16/17).
 *
 * `approval/requested` and `question/requested` frames render as inline
 * cards at the conversation tail. The answer rides the respond relay
 * echoing the frame's own token (lib/respond.ts) - the browser mints
 * nothing; the card settles from the broadcast resolved frame, which
 * also covers a second tab or the terminal answering it (the fold flips
 * the card state when that frame lands, whatever answered).
 *
 * A `bad-response` refusal keeps the card answerable (AC 17: never dead),
 * showing a quiet retry note; a transport failure likewise keeps it.
 */
import { useState } from "react";
import { RiQuestionLine, RiShieldCheckLine } from "@remixicon/react";
import type { PendingCard } from "@/lib/transcript";
import { answerApproval, answerQuestions, cancelQuestion } from "@/lib/respond";
import { Button } from "@/components/ui/button";

type CardProps = {
  card: PendingCard;
  onSettled?: () => void;
};

export function ApprovalCard({ card }: CardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const frame = card.frame;
  const approvalId = frame.type === "approval/requested" ? frame.approvalId : "";
  const toolName = frame.type === "approval/requested" ? frame.toolName : "tool";
  const reason = frame.type === "approval/requested" ? frame.reason : undefined;

  if (card.state === "resolved") {
    return (
      <div
        className="flex items-center gap-2 rounded-md px-1.5 py-[3px] text-[0.8125rem] leading-5 text-muted-foreground"
        data-testid="approval-resolved"
      >
        <span
          aria-hidden
          className={`flex h-4 w-4 shrink-0 items-center justify-center ${
            card.outcome === "rejected" ? "text-amber-600 dark:text-amber-500" : "text-primary"
          }`}
        >
          <RiShieldCheckLine className="h-4 w-4" />
        </span>
        <span className="shrink-0 font-medium text-foreground/70">Approval</span>
        <span aria-hidden className="shrink-0 text-muted-foreground/40">
          ·
        </span>
        <span className="min-w-0 truncate">
          <span className="font-mono">{toolName}</span> {outcomeLabel(card.outcome)}
        </span>
      </div>
    );
  }

  const answer = async (outcome: "allowed-once" | "rejected"): Promise<void> => {
    if (card.answerToken === undefined || submitting) return;
    setSubmitting(true);
    setRefused(null);
    const result = await answerApproval({
      answerToken: card.answerToken,
      sessionId: frame.sessionId,
      approvalId,
      outcome,
    });
    if (result.status === "transport") {
      setRefused("the host is unreachable - try again");
      setSubmitting(false);
    } else if (result.status === "rejected") {
      setRefused("the host refused this answer - try again");
      setSubmitting(false);
    }
    // accepted / not-pending: the resolved frame settles the card.
  };

  return (
    <div
      className="my-1.5 rounded-xl border border-amber-500/35 bg-amber-500/[0.06] px-3 py-2.5 shadow-xs"
      data-testid="approval-card"
    >
      <div className="flex items-center gap-2 text-[0.8125rem]">
        <span aria-hidden className="text-amber-600 dark:text-amber-500">
          <RiShieldCheckLine className="h-4 w-4" />
        </span>
        <span className="font-medium">Needs your call</span>
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{toolName}</span>
      </div>
      {reason !== undefined && reason !== "" && (
        <p className="mt-1 pl-6 text-[0.8rem] leading-[1.5] text-muted-foreground">{reason}</p>
      )}
      {refused !== null && <p className="mt-1.5 pl-6 text-xs text-destructive">{refused}</p>}
      <div className="mt-2.5 flex gap-2 pl-6">
        <Button size="xs" onClick={() => void answer("allowed-once")} disabled={submitting}>
          Allow once
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void answer("rejected")}
          disabled={submitting}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

/** The settled wording of an approval, in the reader's words not the wire's. */
function outcomeLabel(outcome: string | undefined): string {
  if (outcome === "allowed-once") return "allowed";
  if (outcome === "rejected") return "rejected";
  return String(outcome ?? "resolved");
}

export function QuestionCard({ card }: CardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const frame = card.frame;
  if (frame.type !== "question/requested") return null;
  const questions = frame.questions;

  if (card.state === "resolved") {
    return (
      <div
        className="flex items-center gap-2 rounded-md px-1.5 py-[3px] text-[0.8125rem] leading-5 text-muted-foreground"
        data-testid="question-resolved"
      >
        <span
          aria-hidden
          className="flex h-4 w-4 shrink-0 items-center justify-center text-primary"
        >
          <RiQuestionLine className="h-4 w-4" />
        </span>
        <span className="shrink-0 font-medium text-foreground/70">Questions</span>
        <span aria-hidden className="shrink-0 text-muted-foreground/40">
          ·
        </span>
        <span className="min-w-0 truncate">
          {card.outcome === "answered" ? "answered" : "dismissed"}
        </span>
      </div>
    );
  }

  return (
    <QuestionForm
      key={questions.map((q) => q.id).join("-")}
      questions={questions.map((q) => ({
        id: q.id,
        question: q.question,
        header: q.header,
        detail: q.detail,
        options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })),
        multi: q.multiSelect === true,
      }))}
      onSubmit={async (answers) => {
        if (card.answerToken === undefined) return;
        setSubmitting(true);
        setRefused(null);
        const result = await answerQuestions({
          answerToken: card.answerToken,
          sessionId: frame.sessionId,
          answers,
        });
        if (result.status === "transport") {
          setRefused("the host is unreachable - try again");
          setSubmitting(false);
        } else if (result.status === "rejected") {
          setRefused("the answer was refused - adjust and retry");
          setSubmitting(false);
        }
        // accepted / not-pending: the resolved frame settles the card.
      }}
      onDismiss={async () => {
        if (card.answerToken === undefined) return;
        const result = await cancelQuestion({ answerToken: card.answerToken });
        if (result.status === "transport" || result.status === "rejected") {
          setRefused("could not dismiss - try again");
        }
      }}
      submitting={submitting}
      refused={refused}
    />
  );
}

/** Local question-view shape (widened option list), validated as a BATCH. */
interface QuestionView {
  id: string;
  question: string;
  header?: string | undefined;
  detail?: string | undefined;
  options: { label: string; description?: string | undefined }[];
  multi: boolean;
}

function QuestionForm({
  questions,
  onSubmit,
  onDismiss,
  submitting,
  refused,
}: {
  questions: QuestionView[];
  onSubmit: (
    answers: { id: string; selected: string[]; custom?: string }[],
  ) => Promise<void> | void;
  onDismiss: () => void;
  submitting: boolean;
  refused: string | null;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  const answerFor = (
    q: QuestionView,
  ): { id: string; selected: string[]; custom?: string } | null => {
    const picks = selected[q.id] ?? [];
    const free = (custom[q.id] ?? "").trim();
    if (picks.length === 0 && free === "") return null;
    return { id: q.id, selected: picks, ...(free !== "" ? { custom: free } : {}) };
  };
  const complete = questions.every((q) => answerFor(q) !== null);

  const toggle = (q: QuestionView, label: string): void => {
    setSelected((prev) => {
      const cur = prev[q.id] ?? [];
      if (!q.multi) return { ...prev, [q.id]: cur.includes(label) ? [] : [label] };
      return {
        ...prev,
        [q.id]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
      };
    });
  };

  return (
    <form
      className="my-1.5 space-y-3.5 rounded-xl border border-primary/30 bg-primary/[0.04] px-3 py-2.5 shadow-xs"
      data-testid="question-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && !submitting) {
          const answers = questions
            .map((q) => answerFor(q))
            .filter((a): a is { id: string; selected: string[]; custom?: string } => a !== null);
          void onSubmit(answers);
        }
      }}
    >
      <div className="flex items-center gap-2 text-[0.8125rem]">
        <span aria-hidden className="text-primary">
          <RiQuestionLine className="h-4 w-4" />
        </span>
        <span className="font-medium">
          {questions.length > 1 ? `${questions.length} questions` : "A question"}
        </span>
        <span aria-hidden className="text-muted-foreground/40">
          ·
        </span>
        <span className="text-[0.78rem] text-muted-foreground">
          the agent is waiting on this to continue
        </span>
      </div>
      {questions.map((q) => (
        <fieldset key={q.id} disabled={submitting} className="space-y-1.5 pl-6">
          {q.header !== undefined && q.header !== "" && (
            <legend className="mb-1 text-[0.68rem] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              {q.header}
            </legend>
          )}
          <div className="text-[0.8125rem] font-medium">{q.question}</div>
          {q.detail !== undefined && q.detail !== "" && (
            <p className="text-[0.78rem] leading-[1.5] text-muted-foreground">{q.detail}</p>
          )}
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {q.options.map((o) => {
                const active = (selected[q.id] ?? []).includes(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => toggle(q, o.label)}
                    aria-pressed={active}
                    title={o.description}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-background/60 hover:bg-muted"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
          <input
            aria-label={`Custom answer for ${q.question}`}
            value={custom[q.id] ?? ""}
            onChange={(e) => setCustom((prev) => ({ ...prev, [q.id]: e.target.value }))}
            placeholder="Or type an answer…"
            className="w-full rounded-lg border border-input bg-background/70 px-2.5 py-1.5 text-xs outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </fieldset>
      ))}
      {refused !== null && <p className="pl-6 text-xs text-destructive">{refused}</p>}
      <div className="flex items-center gap-2 pl-6">
        <Button type="submit" size="xs" disabled={!complete || submitting}>
          {submitting ? "Sending…" : "Submit answers"}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss} disabled={submitting}>
          Dismiss
        </Button>
        <span className="ml-auto text-[0.7rem] text-muted-foreground/70">
          {questions.length > 1 ? "answer all to submit" : "pick or type"}
        </span>
      </div>
    </form>
  );
}
