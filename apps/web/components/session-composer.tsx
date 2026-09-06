"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import ReactDOM from "react-dom";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { activeAtToken } from "@deepseek-ai/dsh-file-reference/grammar";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  RiChat3Line,
  RiFileLine,
  RiInboxLine,
  RiSendPlane2Fill,
  RiStopLine,
  RiTerminalBoxLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const DEFAULT_PLACEHOLDER = "Message the session";

// --- Injected trigger sources -------------------------------------------------
//
// Each surface injects its own option lists, so the `/` and `@` menus differ
// per surface: the session page injects session commands and file references,
// home injects its own sources. An empty source disables its trigger entirely
// (its plugin never mounts, no menu opens, Enter never defers to it).

/** One async `@` search outcome: the options, plus a hint line rendered
 * OUTSIDE the option list (the list stays all-choices). */
export type ComposerSearch = { entries: ComposerEntry[]; hint?: string };

export type ComposerEntry = {
  label: string;
  description: string;
  kind: "command" | "file" | "session";
  /**
   * Text inserted when the entry is picked, when it differs from the label
   * (session references insert their mention token, not the display label).
   */
  insertText?: string;
  /** Stable option key; labels may repeat (untitled sessions all say "New Session"). */
  key?: string;
};

/** Which inbox placement a submit gesture asked for (AC 13). */
export type SendMode = "steer" | "queue";

export type SessionComposerProps = {
  /** Injected `/` source. */
  commands: ComposerEntry[];
  /**
   * Pluggable submit action, supplied by the surface. Resolving means the text
   * was accepted: the composer clears the draft. Rejecting means failure: the
   * surface renders the error and the composer preserves the draft for retry.
   * The mode is the gesture that fired it (story #134 AC 13): the session
   * page steers on the primary gesture and queues on the chord/secondary;
   * surfaces without modes (home) ignore the parameter.
   */
  onSubmit: (text: string, mode: SendMode) => Promise<unknown>;
  /** Empty-state text and accessible name; defaults to the session wording. */
  placeholder?: string;
  /** Injected `@` source (static list; filtered locally against the query). */
  references: ComposerEntry[];
  /**
   * Optional async `@` source (session search). When present it replaces the
   * static `references` list as the `@` menu's options, queried per keystroke
   * with the current `@` text; results render as-is (the plugin does no
   * further filtering). Presence also mounts the `@` trigger even with an
   * empty static list.
   */
  referenceSearch?: (query: string) => Promise<ComposerSearch>;
  /**
   * Whether the surface accepts interaction at all (default true). Home
   * requires a chosen working folder first: while false the editor stays
   * non-editable (the SSR gate is never lifted), the send control is
   * disabled, and Enter is swallowed. The session page never passes false.
   */
  enabled?: boolean;
  /**
   * Invoked when a LOCKED composer's editor area is clicked or activated
   * by keyboard. Home points this at the folder dialog, so tapping the
   * input while no working folder is chosen goes straight to the choice
   * the lock is asking for. Only ever fires while `enabled` is false.
   */
  onLockedActivate?: () => void;
  /**
   * Visible text on the send button (design packet: home's submit is
   * "Start session" - the one first-screen action that says its name).
   * Absent on a surface with no modes and no label of its own, the control
   * is then the icon-only square carrying the "Send message" accessible name.
   */
  submitLabel?: string;
  /**
   * Footer text while LOCKED - the remedy the lock asks for ("Choose a
   * folder to start."), not the shortcut legend of an editor that does
   * not yet accept typing.
   */
  lockedHint?: string;
  /**
   * Turn-state chrome (session page, AC 13/15): idle shows one Send button;
   * while a turn runs the pair becomes **Steer** / **Queue** (Enter steers,
   * Cmd/Ctrl+Enter queues) and the stop control joins the row. Default false
   * keeps home's single-submit chrome untouched.
   */
  sendModes?: boolean;
  /** Whether a turn is running (drives the stop control). */
  running?: boolean;
  /** Stop the running turn (AC 15); rendered only while `running`. */
  onStop?: () => void;
  /**
   * Whether the surface holds pending attachments (image intake, AC 18):
   * with true, a send with NO text is allowed (image-only prompts).
   */
  hasAttachments?: () => boolean;
  /**
   * Legend text for the `@` affordance (the session page's source is
   * files AND sessions; home keeps "@ sessions").
   */
  referenceHint?: string;
};

class ComposerOption extends MenuOption {
  kind: "command" | "file" | "session";
  label: string;
  description: string;
  insertText: string | undefined;

  constructor(
    kind: "command" | "file" | "session",
    label: string,
    description: string,
    insertText?: string,
    key?: string,
  ) {
    super(key ?? label);
    this.kind = kind;
    this.label = label;
    this.description = description;
    this.insertText = insertText;
  }
}

// --- Trigger matching ---------------------------------------------------------
// Custom trigger fns (not useBasicTypeaheadTriggerMatch): the default
// punctuation set terminates queries at "." and "/" - poison for file paths.
// The `@` query is "anything up to whitespace or a new @" so non-ASCII
// session titles reach the search source (`\w` is ASCII-only and would cut
// a CJK query at zero characters); the `@` itself is excluded so a second
// `@` starts a fresh reference instead of extending the first.

// `(^|\s)`: the menu opens after any word boundary, not only at line
// start - typing "fix this /mode" must offer commands like dsh web does.
const SLASH_TRIGGER_REGEX = /(^|\s)\/([\w-]*)$/u;
function checkForSlashTrigger(text: string): MenuTextMatch | null {
  const match = SLASH_TRIGGER_REGEX.exec(text);
  if (match === null) return null;
  const leading = match[1];
  const query = match[2];
  if (leading === undefined || query === undefined) return null;
  return {
    leadOffset: match.index + leading.length,
    matchingString: query,
    replaceableString: "/" + query,
  };
}

// The `@` trigger is the HOST grammar (AC 21): dsh-file-reference's
// browser-safe activeAtToken - quoted paths, email-like interiors, and
// cursor anchoring are its rules, not this file's. vendored-grammar.test.ts
// pins the contract the UI relies on; a host bump that re-tokenizes fails
// there instead of silently changing the menu.
function checkForAtTrigger(text: string): MenuTextMatch | null {
  const line = text.slice(text.lastIndexOf("\n") + 1);
  const token = activeAtToken(line, line.length);
  if (token === undefined) return null;
  return {
    leadOffset: text.length - token.prefix.length,
    matchingString: token.query,
    replaceableString: token.prefix,
  };
}

function filterOptions<T extends { label: string }>(entries: T[], query: string | null): T[] {
  if (query === null) return [];
  const needle = query.toLowerCase();
  return entries.filter((entry) => entry.label.toLowerCase().includes(needle));
}

// --- Menu rendering (shared by both triggers) ---------------------------------

type MenuItemProps = {
  selectedIndex: number | null;
  selectOptionAndCleanUp: (option: ComposerOption) => void;
  setHighlightedIndex: (index: number) => void;
  options: ComposerOption[];
};

function renderMenu(
  anchorElementRef: RefObject<HTMLElement | null>,
  { selectedIndex, options, selectOptionAndCleanUp, setHighlightedIndex }: MenuItemProps,
  hint?: string,
) {
  if (anchorElementRef.current === null || options.length === 0) return null;
  // Viewport-safe placement (the caret-anchored 288px-min menu walked off
  // a 390px phone): ride just above the editor box, width capped to the
  // viewport, left edge clamped inside it. The caret anchor div lives on
  // document.body, so the box itself is the stable reference.
  const editorBox = document.querySelector('[contenteditable="true"]');
  const anchorRect = (editorBox ?? anchorElementRef.current).getBoundingClientRect();
  const width = Math.min(384, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - width - 8));
  return ReactDOM.createPortal(
    <div
      className="z-50 overflow-hidden rounded-none bg-popover/70 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150"
      style={{
        position: "fixed",
        left,
        width,
        bottom: window.innerHeight - anchorRect.top + 4,
      }}
    >
      <ul className="max-h-60 overflow-y-auto">
        {options.map((option, index) => (
          <li
            key={option.key}
            ref={option.setRefElement}
            role="option"
            aria-selected={selectedIndex === index}
            tabIndex={-1}
            onMouseEnter={() => setHighlightedIndex(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              selectOptionAndCleanUp(option);
            }}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-none px-2 py-1.5 text-xs outline-none",
              selectedIndex === index && "bg-accent text-accent-foreground",
            )}
          >
            {option.kind === "command" ? (
              <RiTerminalBoxLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : option.kind === "session" ? (
              <RiChat3Line className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <RiFileLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{option.label}</span>
              <span className="truncate text-muted-foreground">{option.description}</span>
            </span>
          </li>
        ))}
      </ul>
      {hint !== undefined && (
        // A signal, not a choice: outside the option list, unselectable.
        <p className="border-t border-input px-2 py-1 text-2xs text-muted-foreground">{hint}</p>
      )}
    </div>,
    anchorElementRef.current,
  );
}

// --- Submission ----------------------------------------------------------------
//
// In-flight state gates every submit path: the send control shows a spinner
// and is disabled, and Enter is swallowed - a double submit is impossible.
// pendingRef is the synchronous twin of isPending: the Enter command handler
// checks the ref directly, so a second Enter dispatched before the re-render
// still cannot submit.

function useComposerSubmit({
  onSubmit,
  pendingRef,
  enabledRef,
  setIsPending,
  hasAttachments,
}: {
  onSubmit: (text: string, mode: SendMode) => Promise<unknown>;
  pendingRef: RefObject<boolean>;
  /** Sync gate from the surface (e.g. "no working folder chosen yet"). */
  enabledRef: RefObject<boolean>;
  setIsPending: (pending: boolean) => void;
  hasAttachments?: (() => boolean) | undefined;
  referenceHint?: string | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  // Latest-ref: surfaces pass inline closures; without this the submit
  // callback (and the Enter handler registered on it) would be rebuilt - and
  // the command listener re-registered - on every keystroke.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  return useCallback(
    (mode: SendMode = "steer") => {
      if (pendingRef.current) return;
      // Surface refused the send (disabled state): swallow it on every path,
      // button and Enter alike.
      if (!enabledRef.current) return;
      let text = "";
      editor.getEditorState().read(() => {
        text = $getRoot().getTextContent().trim();
      });
      if (text.length === 0 && hasAttachments?.() !== true) return;
      pendingRef.current = true;
      setIsPending(true);
      void (async () => {
        try {
          await onSubmitRef.current(text, mode);
          // Accepted: drop the draft (the surface navigates or shows it sent).
          // The editor may already be gone when the action navigates away.
          const root = editor.getRootElement();
          if (root !== null && root.isConnected) {
            editor.update(() => {
              $getRoot().clear();
            });
          }
        } catch {
          // Failed: preserve the draft for retry; the surface renders the error.
        } finally {
          pendingRef.current = false;
          setIsPending(false);
          const root = editor.getRootElement();
          if (root !== null && root.isConnected) editor.focus();
        }
      })();
    },
    [editor, pendingRef, setIsPending, hasAttachments],
  );
}

function submitWithEnter(
  editor: LexicalEditor,
  event: KeyboardEvent | null,
  menuOpenRef: RefObject<boolean>,
  pendingRef: RefObject<boolean>,
  submit: (mode: SendMode) => void,
  sendModes: boolean,
): boolean {
  if (event === null) return false;
  // IME composition: block Lexical's other Enter handlers but never
  // preventDefault, so the native composition confirm proceeds.
  if (event.isComposing || event.keyCode === 229) return true;
  // While a typeahead menu is open, Enter selects the highlighted option.
  if (menuOpenRef.current) return false;
  event.preventDefault();
  if (event.shiftKey) {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertLineBreak();
    });
    return true;
  }
  // In flight: swallow the Enter - no submit, no newline.
  if (pendingRef.current) return true;
  // The queue chord (AC 13, packet Q2): Cmd/Ctrl+Enter queues on a
  // mode-aware surface; elsewhere plain Enter submits whatever it means.
  if (sendModes && (event.metaKey || event.ctrlKey)) {
    submit("queue");
    return true;
  }
  submit(sendModes ? "steer" : "steer");
  return true;
}

function EnterToSendPlugin({
  menuOpenRef,
  pendingRef,
  submit,
  sendModes,
}: {
  menuOpenRef: RefObject<boolean>;
  pendingRef: RefObject<boolean>;
  submit: (mode: SendMode) => void;
  sendModes: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) =>
        submitWithEnter(editor, event, menuOpenRef, pendingRef, submit, sendModes),
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, menuOpenRef, pendingRef, submit, sendModes]);
  return null;
}

// The editor ships editable:false (the SSR attribute is contenteditable=false,
// so the browser drops pre-hydration typing instead of feeding text that
// hydration would discard); effects only run once hydrated, where this gate
// lifts the SSR lock when the surface allows interaction (default yes) and
// takes the focus the moment it does. Home keeps the lock until a working
// folder is chosen, so the first real click-to-type lands on an enabled
// editor instead of dead text.
function EditableGatePlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(enabled);
    if (enabled) editor.focus();
  }, [editor, enabled]);
  return null;
}

/**
 * The send controls, per turn state. A mode-aware surface (the session page)
 * shows ONE Send button while the session is idle - with no turn running,
 * steer and queue are the same gesture and naming two of them is noise - and
 * the two named gestures only while a turn runs: **Steer** interrupts it,
 * **Queue** waits its turn. A surface without modes (home) keeps its single
 * labelled submit whatever the state.
 *
 * `isPending` disables the controls: one send in flight is the contract the
 * Enter handler shares (see `useComposerSubmit`).
 */
function SendControls({
  hasText,
  isPending,
  sendEnabled,
  submit,
  submitLabel,
  sendModes,
  running,
}: {
  hasText: boolean;
  isPending: boolean;
  sendEnabled: boolean;
  submit: (mode: SendMode) => void;
  /** Visible text (home: "Start session"); absent keeps the icon-only square. */
  submitLabel: string | undefined;
  sendModes: boolean;
  running: boolean;
}) {
  const disabled = !hasText || isPending || !sendEnabled;
  if (!sendModes || !running) {
    return (
      <Button
        type="button"
        variant="default"
        size={submitLabel === undefined && !sendModes ? "icon-sm" : "xs"}
        aria-label={submitLabel ?? "Send message"}
        title={sendModes ? "Send this message" : undefined}
        disabled={disabled}
        onClick={() => submit("steer")}
      >
        {isPending ? <Spinner /> : <RiSendPlane2Fill />}
        {(submitLabel !== undefined || sendModes) && (submitLabel ?? "Send")}
      </Button>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="default"
        size="xs"
        aria-label="Steer the session now"
        title="Steer - interrupt the running turn with this message"
        disabled={disabled}
        onClick={() => submit("steer")}
      >
        {isPending ? <Spinner /> : <RiSendPlane2Fill />}
        Steer
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label="Queue this message"
        title="Queue - let the current turn finish first (⌘/Ctrl+Enter)"
        disabled={disabled}
        onClick={() => submit("queue")}
      >
        <RiInboxLine />
        Queue
      </Button>
    </>
  );
}

// --- Typeahead menus (inside the editor context) -------------------------------

function TypeaheadMenus({
  menuOpenRef,
  commands,
  references,
  referenceSearch,
}: {
  menuOpenRef: RefObject<boolean>;
  commands: ComposerEntry[];
  references: ComposerEntry[];
  referenceSearch: ((query: string) => Promise<ComposerSearch>) | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [atQuery, setAtQuery] = useState<string | null>(null);
  // The async `@` source's live results (session search), keyed to the query
  // that produced them; only the newest response may publish (a slow early
  // query must not overwrite a fast later one).
  const [searchedRefs, setSearchedRefs] = useState<{
    query: string;
    entries: ComposerEntry[];
    hint?: string;
  }>({ query: "", entries: [] });
  const searchSeq = useRef(0);

  const slashOptions = useMemo(
    () =>
      filterOptions(commands, slashQuery).map(
        (entry) => new ComposerOption(entry.kind, entry.label, entry.description),
      ),
    [commands, slashQuery],
  );
  const atOptions = useMemo(() => {
    const source =
      referenceSearch === undefined
        ? filterOptions(references, atQuery)
        : atQuery !== null && searchedRefs.query === atQuery
          ? searchedRefs.entries
          : [];
    return source.map(
      (entry) =>
        new ComposerOption(entry.kind, entry.label, entry.description, entry.insertText, entry.key),
    );
  }, [referenceSearch, references, atQuery, searchedRefs]);
  // The hint belongs to the CURRENT query's response only.
  const atHint =
    referenceSearch !== undefined && atQuery !== null && searchedRefs.query === atQuery
      ? searchedRefs.hint
      : undefined;

  const handleAtQueryChange = useCallback(
    (query: string | null) => {
      setAtQuery(query);
      if (referenceSearch === undefined) return;
      if (query === null) {
        // Invalidate any in-flight response too: it no longer belongs to an open query.
        searchSeq.current += 1;
        setSearchedRefs({ query: "", entries: [] });
        return;
      }
      // The EMPTY query searches too (recent sessions) - typing `@` alone
      // must offer something immediately, not wait for a query.
      const seq = ++searchSeq.current;
      void referenceSearch(query).then(
        (result) => {
          if (seq === searchSeq.current)
            setSearchedRefs({
              query,
              entries: result.entries,
              ...(result.hint !== undefined && { hint: result.hint }),
            });
        },
        () => {
          // Failed search: show nothing; the draft and Enter-to-send are unaffected.
          if (seq === searchSeq.current) setSearchedRefs({ query, entries: [] });
        },
      );
    },
    [referenceSearch],
  );

  const selectOption = useCallback(
    (option: ComposerOption, textNodeContainingQuery: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const text = option.insertText ?? option.label;
        // Descent rule (AC 21): a quoted, still-open directory mention
        // (`@"dir/` with no closing quote) must not gain a trailing space -
        // the space lands inside the open quote and kills descent. Closed
        // or unquoted mentions finish the token and take the space.
        const staysOpen = text.startsWith('@"') && !text.endsWith('"');
        const replacement = $createTextNode(staysOpen ? text : text + " ");
        if (textNodeContainingQuery !== null) {
          textNodeContainingQuery.replace(replacement);
        } else {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          selection.insertText(text + " ");
        }
        const end = replacement.getTextContent().length;
        replacement.select(end, end);
      });
      closeMenu();
    },
    [editor],
  );

  // Stable identities: the plugin registers these as effect deps, so new
  // closures per keystroke would re-register its listeners on every update.
  const handleMenuOpen = useCallback(() => {
    menuOpenRef.current = true;
  }, [menuOpenRef]);
  const handleMenuClose = useCallback(() => {
    menuOpenRef.current = false;
  }, [menuOpenRef]);

  return (
    <>
      {commands.length > 0 && (
        <LexicalTypeaheadMenuPlugin
          onQueryChange={setSlashQuery}
          onSelectOption={selectOption}
          options={slashOptions}
          triggerFn={checkForSlashTrigger}
          menuRenderFn={renderMenu}
          onOpen={handleMenuOpen}
          onClose={handleMenuClose}
          preselectFirstItem
        />
      )}
      {(references.length > 0 || referenceSearch !== undefined) && (
        <LexicalTypeaheadMenuPlugin
          onQueryChange={handleAtQueryChange}
          onSelectOption={selectOption}
          options={atOptions}
          triggerFn={checkForAtTrigger}
          menuRenderFn={(anchor, props) => renderMenu(anchor, props, atHint)}
          onOpen={handleMenuOpen}
          onClose={handleMenuClose}
          preselectFirstItem
        />
      )}
    </>
  );
}

// --- Composer -------------------------------------------------------------------

// Inner component so the submit callback can read the editor context while
// SessionComposer itself stays the context provider.
function ComposerInner({
  commands,
  hasText,
  isPending,
  menuOpenRef,
  onSubmit,
  pendingRef,
  placeholder,
  references,
  referenceSearch,
  enabled,
  onLockedActivate,
  submitLabel,
  lockedHint,
  setIsPending,
  sendModes,
  running,
  onStop,
  hasAttachments,
  referenceHint,
}: {
  commands: ComposerEntry[];
  hasText: boolean;
  isPending: boolean;
  menuOpenRef: RefObject<boolean>;
  onSubmit: (text: string, mode: SendMode) => Promise<unknown>;
  pendingRef: RefObject<boolean>;
  placeholder: string;
  references: ComposerEntry[];
  referenceSearch: ((query: string) => Promise<ComposerSearch>) | undefined;
  enabled: boolean;
  onLockedActivate: (() => void) | undefined;
  submitLabel: string | undefined;
  lockedHint: string | undefined;
  setIsPending: (pending: boolean) => void;
  sendModes: boolean;
  running: boolean;
  onStop?: (() => void) | undefined;
  hasAttachments?: (() => boolean) | undefined;
  referenceHint?: string | undefined;
}) {
  // Sync twin of the enabled prop for the submit paths (same reason
  // pendingRef exists: a click/Enter can arrive before the re-render).
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  const submit = useComposerSubmit({
    onSubmit,
    pendingRef,
    enabledRef,
    setIsPending,
    ...(hasAttachments !== undefined ? { hasAttachments } : {}),
  });
  // The hint advertises only the triggers this surface actually injected: an
  // empty source mounts no menu, so advertising it would be a lie. The send
  // chord's meaning follows the buttons: with a turn running, Enter steers
  // and the chord queues; idle, Enter just sends. Shift+Enter is
  // discoverable on its own.
  const hint = [
    sendModes
      ? running === true
        ? "Enter steers · ⌘/Ctrl+Enter queues"
        : "Enter sends"
      : "Enter sends",
    commands.length > 0 && "/ commands",
    referenceSearch !== undefined
      ? (referenceHint ?? "@ sessions")
      : references.length > 0 && "@ files",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="rounded-none border border-input bg-card transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 dark:bg-input/25">
        <div className="relative">
          {!enabled && (
            // The locked affordance: the editor area becomes the trigger
            // for the surface's unlock action (home: the folder dialog).
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose a working folder to start"
              onClick={onLockedActivate}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onLockedActivate?.();
                }
              }}
              className="absolute inset-0 z-10 cursor-text"
            />
          )}
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={placeholder}
                className="block max-h-48 min-h-11 overflow-y-auto px-3 py-2.5 text-sm leading-normal outline-none"
              />
            }
            placeholder={
              <div className="pointer-events-none absolute inset-x-0 top-0 px-3 py-2.5 text-sm text-muted-foreground/70">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-2.5 py-1.5">
          {/* While locked the footer states the remedy, not the shortcuts of
              an editor that does not accept typing yet (design packet). */}
          <p className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground/70">
            {enabled || lockedHint === undefined ? hint : lockedHint}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {sendModes &&
              running === true &&
              onStop !== undefined && (
                // AC 15: while a turn runs, the stop control joins the two
                // mode gestures - the one moment cancelling is as meaningful
                // as steering.
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Stop current turn"
                  title="Stop the running turn"
                  onClick={onStop}
                >
                  <RiStopLine />
                </Button>
              )}
            <SendControls
              hasText={hasText || hasAttachments?.() === true}
              isPending={isPending}
              sendEnabled={enabled}
              submit={submit}
              submitLabel={submitLabel}
              sendModes={sendModes === true}
              running={running === true}
            />
          </div>
        </div>
      </div>
      <EnterToSendPlugin
        menuOpenRef={menuOpenRef}
        pendingRef={pendingRef}
        submit={submit}
        sendModes={sendModes}
      />
      <TypeaheadMenus
        menuOpenRef={menuOpenRef}
        commands={commands}
        references={references}
        referenceSearch={referenceSearch}
      />
    </>
  );
}

export function SessionComposer({
  onSubmit,
  commands,
  references,
  placeholder = DEFAULT_PLACEHOLDER,
  referenceSearch,
  enabled = true,
  onLockedActivate,
  submitLabel,
  lockedHint,
  sendModes = false,
  running = false,
  onStop,
  hasAttachments,
  referenceHint,
}: SessionComposerProps) {
  const [hasText, setHasText] = useState(false);
  const [isPending, setIsPending] = useState(false);
  // Whether a typeahead menu is open; the Enter handler defers to the menu's
  // option selection while this is set. onOpen/onClose fire on open/close
  // transitions of the plugin's resolution.
  const menuOpenRef = useRef(false);
  const pendingRef = useRef(false);

  const initialConfig = {
    namespace: "dsh-session-composer",
    // Flipped to true by EditableGatePlugin once hydrated.
    editable: false,
    onError: (error: unknown) => {
      console.error("[session-composer]", error);
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ComposerInner
        commands={commands}
        hasText={hasText}
        isPending={isPending}
        menuOpenRef={menuOpenRef}
        onSubmit={onSubmit}
        pendingRef={pendingRef}
        placeholder={placeholder}
        references={references}
        referenceSearch={referenceSearch}
        enabled={enabled}
        onLockedActivate={onLockedActivate}
        submitLabel={submitLabel}
        lockedHint={lockedHint}
        setIsPending={setIsPending}
        sendModes={sendModes}
        running={running}
        {...(onStop !== undefined ? { onStop } : {})}
        {...(hasAttachments !== undefined ? { hasAttachments } : {})}
        {...(referenceHint !== undefined ? { referenceHint } : {})}
      />
      <OnChangePlugin
        onChange={(editorState) => {
          editorState.read(() => {
            setHasText($getRoot().getTextContent().trim().length > 0);
          });
        }}
      />
      <HistoryPlugin />
      <EditableGatePlugin enabled={enabled} />
    </LexicalComposer>
  );
}
