/**
 * Trust fence at the transport edge (ADR-0004): the gateway answers 401/403
 * when HTTP basic-auth credentials are missing or refused. Both the unary
 * POST leg and the stream-open leg funnel through the client's doFetch seam,
 * so one check there maps those statuses to a dedicated error the app can
 * turn into a login prompt instead of an opaque transport failure.
 * Mid-stream revocation is unreachable here: statuses only arrive at open
 * time; the reconnect loop re-hits the fence on every reopen.
 * Redirect edge case: fetch follows redirects, so a redirect chain ending
 * at a 200 login page bypasses the fence (the JSON parse then fails
 * instead); the dsh gateway answers /api with 401 directly (ADR-0004).
 */

/** 401/403 at the transport edge: credentials missing or refused. */
export class TrustFenceError extends Error {
  /** The refusing HTTP status. */
  readonly status: 401 | 403;
  /** The request URL the gateway refused. */
  readonly url: string;

  constructor(status: 401 | 403, url: string) {
    super("trust fence: HTTP " + status + " for " + url);
    this.name = "TrustFenceError";
    this.status = status;
    this.url = url;
  }
}

/** Throw TrustFenceError on 401/403; pass every other response through. */
export function assertTrusted(response: Response, url: string | URL): Response {
  if (response.status === 401 || response.status === 403) {
    throw new TrustFenceError(response.status, String(url));
  }
  return response;
}
