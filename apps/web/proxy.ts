/**
 * next-app proxy - the basic-auth fence at the Next edge (ADR-0001,
 * superseded for credential verification by ADR-0007).
 *
 * Next 16's edge-fence entry (the `proxy.ts` convention; `middleware.ts` is
 * deprecated): one fence over the whole surface - pages, /api, and static
 * assets - before any route handler runs. A single user, credentials
 * provisioned as cordis row config on the runtime row and forwarded into
 * this process's environment (ADR-0008) as a self-describing scrypt value
 * (ADR-0007), the native browser dialog (no session UI), and a configurable
 * realm so a deployment reverse proxy that also runs basic auth can share
 * one dialog per origin.
 *
 * Fail-closed posture: when the credential pair is not provisioned (or its
 * value is malformed), every request is denied with 401 and the server logs
 * a loud configuration error once - the surface never serves
 * unauthenticated.
 */
import { scryptSync, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Configurable realm; default matches the README contract. */
const REALM = process.env["DSH_NEXT_APP_REALM"] ?? "dsh-next-app";

/** Whether the loud fail-closed message was already logged (per process). */
let failClosedLogged = false;

/** Whether the loud malformed-value message was already logged (per process). */
let malformedLogged = false;

/** 401 with the header that summons the native browser dialog. */
function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": `Basic realm="${REALM}"` },
    },
  );
}

/** Log the loud fail-closed configuration error once per process. */
function logFailClosed(): void {
  if (failClosedLogged) return;
  failClosedLogged = true;
  console.error(
    "next-app auth: DSH_NEXT_APP_USER and DSH_NEXT_APP_PASSWORD_HASH must both be set; denying every request (fail closed)",
  );
}

/** One parsed `DSH_NEXT_APP_PASSWORD_HASH` value (ADR-0007). */
interface ScryptValue {
  /** The scrypt cost parameter N (a power of two). */
  n: number;
  /** The scrypt cost parameter r. */
  r: number;
  /** The scrypt cost parameter p. */
  p: number;
  /** The salt, decoded. */
  salt: Buffer;
  /** The expected derived key, decoded. */
  expected: Buffer;
}

/**
 * Parse the self-describing scrypt value
 * (`scrypt$<N>,<r>,<p>$<salt-base64>$<key-base64>`, ADR-0007). Deliberately
 * regex-free: the repo's AST-based formatter rewrites `\$` escapes inside
 * regex literals, which would silently break the fence - a plain split is
 * trivially auditable instead.
 */
function parseScryptValue(encoded: string): ScryptValue | undefined {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return undefined;
  const paramPart = parts[1];
  const saltB64 = parts[2];
  const keyB64 = parts[3];
  if (paramPart === undefined || saltB64 === undefined || keyB64 === undefined) return undefined;
  const params = paramPart.split(",");
  if (params.length !== 3) return undefined;
  const nRaw = params[0];
  const rRaw = params[1];
  const pRaw = params[2];
  if (nRaw === undefined || rRaw === undefined || pRaw === undefined) return undefined;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    n <= 0 ||
    r <= 0 ||
    p <= 0
  ) {
    return undefined;
  }
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  // Pin the format (ADR-0007): 16-byte salt, 32-byte key, N a power of two.
  // Without the pins a truncated key decodes to an empty buffer and verifies
  // ANY password - scryptSync with keylen 0 yields an empty buffer and
  // timingSafeEqual(empty, empty) is true. A malformed value must fail
  // closed, never open.
  if (salt.length !== 16 || expected.length !== 32 || (n & (n - 1)) !== 0) {
    return undefined;
  }
  return {
    n,
    r,
    p,
    salt,
    expected,
  };
}

/**
 * Verify one password against the scrypt value (ADR-0007): derive the key
 * with the value's own parameters and compare in constant time. A malformed
 * value verifies as false - the fence fails closed, never open.
 */
function verifyPassword(password: string, encoded: string): boolean {
  const parsed = parseScryptValue(encoded);
  if (parsed === undefined) return false;
  try {
    // scrypt's memory use is ~128 * N * r bytes; give the derivation headroom
    // for raised costs while capping runaway values.
    const derived = scryptSync(password, parsed.salt, parsed.expected.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: Math.max(64 * 1024 * 1024, 256 * parsed.n * parsed.r),
    });
    return timingSafeEqual(derived, parsed.expected);
  } catch {
    return false; // invalid parameters: fail closed
  }
}

/**
 * The fence: valid basic-auth credentials pass, everything else gets 401
 * with the realm header. Verification is a memory-hard scrypt derivation
 * compared in constant time (ADR-0007) - no third-party code on this path.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const user = process.env["DSH_NEXT_APP_USER"];
  const passwordHash = process.env["DSH_NEXT_APP_PASSWORD_HASH"];
  if (user === undefined || user === "" || passwordHash === undefined || passwordHash === "") {
    logFailClosed();
    return unauthorized();
  }

  const header = request.headers.get("authorization");
  if (header === null || header.slice(0, 6).toLowerCase() !== "basic ") return unauthorized();

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon === -1) return unauthorized();

  const name = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  if (name !== user) return unauthorized();
  if (!verifyPassword(password, passwordHash)) {
    if (!malformedLogged && parseScryptValue(passwordHash) === undefined) {
      // The pair is present but the value is malformed or out of the pinned
      // format: fail closed loudly, exactly like a missing pair (ADR-0007) -
      // a truncated value must never silently turn the fence into a
      // username-only check.
      malformedLogged = true;
      console.error(
        "next-app auth: DSH_NEXT_APP_PASSWORD_HASH is malformed or out of format; denying every request (fail closed)",
      );
    }
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  // Every path, including /api and static assets: Next's default matcher
  // skips _next/static, _next/image, and favicon.ico, and the fence gates
  // the whole surface (ADR-0001).
  matcher: ["/:path*"],
};
