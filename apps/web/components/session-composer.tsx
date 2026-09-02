"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
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
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { RiFileLine, RiSendPlane2Fill, RiTerminalBoxLine } from "@remixicon/react";

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

export type ComposerEntry = {
  label: string;
  description: string;
  kind: "command" | "file";
};

export type SessionComposerProps = {
  /** Injected `/` source. */
  commands: ComposerEntry[];
  /**
   * Pluggable submit action, supplied by the surface. Resolving means the text
   * was accepted: the composer clears the draft. Rejecting means failure: the
   * surface renders the error and the composer preserves the draft for retry.
   */
  onSubmit: (text: string) => Promise<unknown>;
  /** Empty-state text and accessible name; defaults to the session wording. */
  placeholder?: string;
  /** Injected `@` source. */
  references: ComposerEntry[];
  /**
   * Surface controls (the story's picker chips) rendered in the footer's
   * left slot; with chips present the trigger hint drops below the card.
   */
  chips?: ReactNode;
};

class ComposerOption extends MenuOption {
  kind: "command" | "file";
  label: string;
  description: string;

  constructor(kind: "command" | "file", label: string, description: string) {
    super(label);
    this.kind = kind;
    this.label = label;
    this.description = description;
  }
}

// --- Trigger matching ---------------------------------------------------------
// Custom trigger fns (not useBasicTypeaheadTriggerMatch): the default
// punctuation set terminates queries at "." and "/" - poison for file paths.

const SLASH_TRIGGER_REGEX = /(^|\n)\/([\w-]*)$/;
const AT_TRIGGER_REGEX = /(^|\s|\n)@([\w.\-/]*)$/;

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

function checkForAtTrigger(text: string): MenuTextMatch | null {
  const match = AT_TRIGGER_REGEX.exec(text);
  if (match === null) return null;
  const leading = match[1];
  const query = match[2];
  if (leading === undefined || query === undefined) return null;
  return {
    leadOffset: match.index + leading.length,
    matchingString: query,
    replaceableString: "@" + query,
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
) {
  if (anchorElementRef.current === null || options.length === 0) return null;
  return ReactDOM.createPortal(
    <div className="absolute top-0 left-0 z-50 max-w-96 min-w-72 overflow-hidden rounded-none bg-popover/70 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-2xl backdrop-saturate-150">
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
  setIsPending,
}: {
  onSubmit: (text: string) => Promise<unknown>;
  pendingRef: RefObject<boolean>;
  setIsPending: (pending: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  // Latest-ref: surfaces pass inline closures; without this the submit
  // callback (and the Enter handler registered on it) would be rebuilt - and
  // the command listener re-registered - on every keystroke.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  return useCallback(() => {
    if (pendingRef.current) return;
    let text = "";
    editor.getEditorState().read(() => {
      text = $getRoot().getTextContent().trim();
    });
    if (text.length === 0) return;
    pendingRef.current = true;
    setIsPending(true);
    void (async () => {
      try {
        await onSubmitRef.current(text);
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
  }, [editor, pendingRef, setIsPending]);
}

function submitWithEnter(
  editor: LexicalEditor,
  event: KeyboardEvent | null,
  menuOpenRef: RefObject<boolean>,
  pendingRef: RefObject<boolean>,
  submit: () => void,
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
  submit();
  return true;
}

function EnterToSendPlugin({
  menuOpenRef,
  pendingRef,
  submit,
}: {
  menuOpenRef: RefObject<boolean>;
  pendingRef: RefObject<boolean>;
  submit: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) =>
        submitWithEnter(editor, event, menuOpenRef, pendingRef, submit),
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, menuOpenRef, pendingRef, submit]);
  return null;
}

// The editor ships editable:false (the SSR attribute is contenteditable=false,
// so the browser drops pre-hydration typing instead of feeding text that
// hydration would discard); effects only run once hydrated, where this gate
// flips editability on and takes the focus.
function EditableGatePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(true);
    editor.focus();
  }, [editor]);
  return null;
}

function SendButton({
  hasText,
  isPending,
  submit,
}: {
  hasText: boolean;
  isPending: boolean;
  submit: () => void;
}) {
  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      aria-label="Send message"
      disabled={!hasText || isPending}
      onClick={submit}
    >
      {isPending ? <Spinner /> : <RiSendPlane2Fill />}
    </Button>
  );
}

// --- Typeahead menus (inside the editor context) -------------------------------

function TypeaheadMenus({
  menuOpenRef,
  commands,
  references,
}: {
  menuOpenRef: RefObject<boolean>;
  commands: ComposerEntry[];
  references: ComposerEntry[];
}) {
  const [editor] = useLexicalComposerContext();
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [atQuery, setAtQuery] = useState<string | null>(null);

  const slashOptions = useMemo(
    () =>
      filterOptions(commands, slashQuery).map(
        (entry) => new ComposerOption(entry.kind, entry.label, entry.description),
      ),
    [commands, slashQuery],
  );
  const atOptions = useMemo(
    () =>
      filterOptions(references, atQuery).map(
        (entry) => new ComposerOption(entry.kind, entry.label, entry.description),
      ),
    [references, atQuery],
  );

  const selectOption = useCallback(
    (option: ComposerOption, textNodeContainingQuery: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const replacement = $createTextNode(option.label + " ");
        if (textNodeContainingQuery !== null) {
          textNodeContainingQuery.replace(replacement);
        } else {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          selection.insertText(option.label + " ");
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
      {references.length > 0 && (
        <LexicalTypeaheadMenuPlugin
          onQueryChange={setAtQuery}
          onSelectOption={selectOption}
          options={atOptions}
          triggerFn={checkForAtTrigger}
          menuRenderFn={renderMenu}
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
  chips,
  commands,
  hasText,
  isPending,
  menuOpenRef,
  onSubmit,
  pendingRef,
  placeholder,
  references,
  setIsPending,
}: {
  chips: ReactNode;
  commands: ComposerEntry[];
  hasText: boolean;
  isPending: boolean;
  menuOpenRef: RefObject<boolean>;
  onSubmit: (text: string) => Promise<unknown>;
  pendingRef: RefObject<boolean>;
  placeholder: string;
  references: ComposerEntry[];
  setIsPending: (pending: boolean) => void;
}) {
  const submit = useComposerSubmit({ onSubmit, pendingRef, setIsPending });
  // The hint advertises only the triggers this surface actually injected: an
  // empty source mounts no menu, so advertising it would be a lie.
  const hint = [
    "Enter send",
    "Shift+Enter newline",
    commands.length > 0 && "/ commands",
    references.length > 0 && "@ files",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="relative rounded-none border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/50 dark:bg-input/30">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={placeholder}
              className="block max-h-48 min-h-12 overflow-y-auto px-2.5 py-2 text-xs outline-none"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute inset-x-0 top-0 px-2.5 py-2 text-xs text-muted-foreground">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <div className="flex items-center justify-between gap-2 border-t border-input px-2.5 py-1.5">
          {chips ?? <p className="text-xs text-muted-foreground">{hint}</p>}
          <SendButton hasText={hasText} isPending={isPending} submit={submit} />
        </div>
      </div>
      {/* With chips in the footer, the trigger hint moves below the card. */}
      {chips !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      <EnterToSendPlugin menuOpenRef={menuOpenRef} pendingRef={pendingRef} submit={submit} />
      <TypeaheadMenus menuOpenRef={menuOpenRef} commands={commands} references={references} />
    </>
  );
}

export function SessionComposer({
  onSubmit,
  commands,
  references,
  placeholder = DEFAULT_PLACEHOLDER,
  chips,
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
        chips={chips}
        commands={commands}
        hasText={hasText}
        isPending={isPending}
        menuOpenRef={menuOpenRef}
        onSubmit={onSubmit}
        pendingRef={pendingRef}
        placeholder={placeholder}
        references={references}
        setIsPending={setIsPending}
      />
      <OnChangePlugin
        onChange={(editorState) => {
          editorState.read(() => {
            setHasText($getRoot().getTextContent().trim().length > 0);
          });
        }}
      />
      <HistoryPlugin />
      <EditableGatePlugin />
    </LexicalComposer>
  );
}
