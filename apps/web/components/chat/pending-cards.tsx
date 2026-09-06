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
        className="my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
        data-testid="approval-resolved"
      >
        Escalation{" "}
        {card.outcome === "allowed-once"
          ? "approved"
          : card.outcome === "rejected"
            ? "rejected"
            : String(card.outcome ?? "resolved")}
        <span className="ml-1 font-mono">{toolName}</span>
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
      className="my-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm"
      data-testid="approval-card"
    >
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        <span className="font-medium">Approval requested</span>
        <span className="font-mono text-xs text-muted-foreground">{toolName}</span>
      </div>
      {reason !== undefined && reason !== "" && (
        <p className="mt-1 text-xs text-muted-foreground">{reason}</p>
      )}
      {refused !== null && <p className="mt-1 text-xs text-destructive">{refused}</p>}
      <div className="mt-2 flex gap-2">
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

export function QuestionCard({ card }: CardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const frame = card.frame;
  if (frame.type !== "question/requested") return null;
  const questions = frame.questions;

  if (card.state === "resolved") {
    return (
      <div
        className="my-1 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
        data-testid="question-resolved"
      >
        Questions {card.outcome === "answered" ? "answered" : "dismissed"}
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
      className="my-2 space-y-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5 text-sm"
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
      {questions.map((q) => (
        <fieldset key={q.id} disabled={submitting} className="space-y-1.5">
          {q.header !== undefined && q.header !== "" && (
            <legend className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
              {q.header}
            </legend>
          )}
          <div className="font-medium">{q.question}</div>
          {q.detail !== undefined && q.detail !== "" && (
            <p className="text-xs text-muted-foreground">{q.detail}</p>
          )}
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
                        : "border-border hover:bg-muted"
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
            className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring"
          />
        </fieldset>
      ))}
      {refused !== null && <p className="text-xs text-destructive">{refused}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="xs" disabled={!complete || submitting}>
          {submitting ? "Sending…" : "Submit answers"}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss} disabled={submitting}>
          Dismiss
        </Button>
        <span className="ml-auto text-[0.7rem] text-muted-foreground">
          {questions.length > 1 ? "answer all to submit" : "pick or type"}
        </span>
      </div>
    </form>
  );
}
