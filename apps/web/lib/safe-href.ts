/**
 * The protocol gate for every href this app renders out of host-presenter
 * data (review security finding #13).
 *
 * Its own module, not a helper inside the card: `lib/` is where this app's
 * pure, unit-tested logic lives (the fold, the fence, the body-limit
 * derivation), and a security gate belongs beside the others rather than
 * buried in one component. Markdown text is covered by `rehype-sanitize`,
 * whose default schema gates `href` on a protocol allowlist; anchors built by
 * hand out of a view's fields bypass that schema entirely, and this is their
 * equivalent.
 *
 * WHY THE GATE AT ALL: `toolEventViewSchema` validates only the view
 * discriminants and leaves the interior unparsed, so `view.url` and a search
 * source's `url` are host-presenter strings built from fetched and searched
 * content - model-influenced data becoming a navigation target.
 */

/**
 * What a URL parser is allowed to discard: C0/C1 controls (tab and newline
 * included) and spaces. Stripping these first is what makes the scheme test
 * below see the same bytes the browser will navigate on - so this character
 * class is deliberate, not an accident worth linting.
 */
// eslint-disable-next-line no-control-regex -- intentional by the doc above
const URL_STRIP = /[\u0000-\u001f\u007f-\u009f ]+/g;

/**
 * The schemes a card may navigate to. http/https is the finding's floor;
 * mailto is the one extra, because it carries no origin to spoof and is the
 * only link a presenter ever emits for a contact address.
 * `hast-util-sanitize` also lets irc/ircs/xmpp through on href - deliberately
 * not copied here: this app has no reason to hand a client an IRC handler.
 */
const SAFE_HREF_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * A navigation target for a card anchor, or null when the string is not safe
 * to navigate to.
 *
 * HOW: strip what a URL parser may discard BEFORE parsing. Browsers drop C0
 * control characters and tab/newline anywhere in a URL and trim surrounding
 * whitespace, so `java\tscript:` and ` javascript:` both reach the parser as
 * `javascript:`. A regex anchored at the raw string's start waves each of
 * them through; parsing first means case (`HTTP://`) and padding cannot spoof
 * the scheme either.
 *
 * Schemeless strings (`/foo`, `#frag`, `example.com/x`) are refused rather
 * than resolved against the app origin: the presenter emits absolute URLs, so
 * a bare path is malformed carrier data, and resolving it would point a
 * hostile string at this app's own routes.
 */
export function safeHref(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.replace(URL_STRIP, ""));
  } catch {
    return null;
  }
  if (!SAFE_HREF_PROTOCOLS.has(parsed.protocol)) return null;
  // A scheme alone is not a target: without a host there is nothing to
  // navigate to (`http://`, `https:x`). mailto is the exception - its "host"
  // is an address.
  if (parsed.protocol !== "mailto:" && parsed.host === "") return null;
  return parsed.href;
}
