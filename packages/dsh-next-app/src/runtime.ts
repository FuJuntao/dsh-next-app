/**
 * next-app-runtime - the next-app profile's boot glue row (ADR-0001).
 *
 * Spawns the packed Next app (`next start`) as a managed child of the dsh
 * host through the base layer's `subprocess` service when the `next-app`
 * profile starts (forwarding the row's basic-auth config - ADR-0008 - and
 * the bridge socket path - ADR-0003 - into the child's environment through
 * the spawn spec's explicit env layer, because the host service scrubs
 * `DSH_*` and credential-shaped names from implicit inheritance): detects
 * readiness from the child's stdout, restarts the child with backoff on
 * unexpected exit, terminates its process tree on profile stop, and
 * announces the serving URL once the child is ready and the Loader tree
 * has settled. The envelope bridge (bridge.ts - ADR-0003 socket lifecycle,
 * ADR-0010 framing) lives in this row: its unix socket is created before
 * the child spawns, its path rides `DSH_NEXT_APP_BRIDGE_SOCKET` in the
 * spawn env, and it is torn down with the row. The dsh `webserver` carrier
 * is deliberately not in the serving path - Next is the only public HTTP
 * surface.
 *
 * Import surface: host packages only, resolved from the user's dsh
 * installation as peerDependencies (ADR-0002).
 *
 * @module @scope/dsh-next-app/runtime
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type { ApiProxy } from "@deepseek-ai/dsh-host-apiproxy";
import type { SubprocessHandle } from "@deepseek-ai/dsh-subprocess";
import Schema from "@deepseek-ai/schemastery";
import { BRIDGE_SOCKET_ENV, startBridge, type BridgeServer } from "./bridge.js";

/** Stable Cordis plugin name. */
export const name = "next-app-runtime";

/** Services required before the boot glue can run. */
export const inject = ["nextAppCli", "subprocess", "apiProxy"];

/** Default bind host: loopback; an all-interfaces bind is guarded by basic auth when provisioned (ADR-0001). */
const DEFAULT_HOST = "127.0.0.1";

/** Default listen port - the same default the in-box web profile uses. */
const DEFAULT_PORT = 3080;

/** The basic-auth block of the row config (ADR-0007 value format). */
interface AuthConfig {
  /** The single allowed username. */
  user?: string;
  /** The scrypt-derived value of the allowed password. */
  passwordHash?: string;
  /** The dialog realm; the app defaults when absent. */
  realm?: string;
}

/**
 * This row's config (ADR-0008, ADR-0009): an id-targeted override in the
 * profile's user patch layer. Validated at load by the same-named schema
 * export - Cordis applies it and fails the boot with an actionable error on
 * invalid configuration (per the harness config docs).
 */
export interface Config {
  /** Bind host; the `--host` flag overrides it (ADR-0009). */
  host: string;
  /** Listen port; the `--port` flag overrides it (ADR-0009). */
  port: number;
  /** Basic-auth config forwarded to the Next child's environment. */
  auth?: AuthConfig;
}

/**
 * The row config schema: defaults fill the serving parameters, the port must
 * be a positive integer, and the auth pair must be complete or absent
 * together (a half-configured pair is a misconfiguration, not a deployment
 * choice - the profile refuses to boot half-gated).
 */
export const Config: Schema<Config> = Schema.object({
  host: Schema.string().default(DEFAULT_HOST),
  port: Schema.number().min(1).step(1).default(DEFAULT_PORT),
  auth: Schema.transform(
    Schema.object({
      user: Schema.string(),
      passwordHash: Schema.string(),
      realm: Schema.string(),
    }),
    (auth): AuthConfig => {
      const userUnset = auth.user === undefined || auth.user === "";
      const hashUnset = auth.passwordHash === undefined || auth.passwordHash === "";
      if (userUnset !== hashUnset) {
        throw new Schema.ValidationError(
          "auth.user and auth.passwordHash must be set together (basic auth, fail-closed); got exactly one",
          { path: ["auth"] },
        );
      }
      // The inferred object output types optionals as string | null; the
      // validated values are plain strings (or absent), so narrow the type.
      return auth as AuthConfig;
    },
  ),
});

/** The Loader service's settle gate, typed structurally; the host provides it. */
interface LoaderLike {
  /** Resolves when the Loader tree settles; undefined when no Loader runs. */
  await(): Promise<void> | undefined;
}

/** This bundle's root (`lib/..`): where the packed app build lives. */
const BUNDLE_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The packed Next app directory - an assembly fact of this bundle, never user config. */
const APP_DIR = join(BUNDLE_ROOT, "web");

/**
 * The bridge socket's run directory: a per-profile subdirectory (mode 0700)
 * under the profile directory the Loader anchors at (`ctx.baseUrl`). The
 * host defines no run-dir concept, so the row owns this one - the socket is
 * per-instance state that must never be packed or shared, and the profile
 * directory is the only in-process anchor to it (ADR-0003).
 */
const RUN_DIR_NAME = "run";

/**
 * The stdout line Next prints once the server accepts connections.
 *
 * REGRESSION NOTE: Next's console output is an implementation detail, not a
 * contract. The catalog pins the exact Next version this marker was verified
 * against (16.3.1); the e2e suite pins it (e2e/specs/ready-marker.spec.ts), so
 * a catalog bump that changes the output fails loudly instead of silently
 * never announcing the URL.
 */
const READY_MARKER = "✓ Ready";

/**
 * Strip ANSI SGR sequences before the ready-line match: Next colorizes its
 * output when FORCE_COLOR is set (GitHub Actions does), and the ready line's
 * content, not its presentation, is the contract here - a colored line must
 * still announce the URL instead of hanging silently.
 */
function stripAnsi(line: string): string {
  // eslint-disable-next-line no-control-regex -- ESC (U+001B) is the ANSI escape introducer; intentional.
  return line.replace(/\u001b\[[0-9;]*m/g, "");
}

/** SIGTERM-to-SIGKILL escalation grace for terminating the child tree. */
const TERMINATE_GRACE_MS = 5000;

/** Initial restart delay after an unexpected exit; doubles per consecutive attempt. */
const INITIAL_RESTART_DELAY_MS = 1000;

/** Ceiling for the restart backoff delay. */
const MAX_RESTART_DELAY_MS = 30000;

/** Uptime after which the consecutive-failure counter resets. */
const STABLE_UPTIME_MS = 30000;

/** Quiet period after which a still-running child with no ready line gets one warning. */
const READY_WARNING_MS = 60000;

/** The URL a browser can use: an all-interfaces bind is announced as loopback. */
function servingUrl(host: string, port: number): string {
  return `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
}

/** Delay before restart attempt `attempts` (1-based), doubling up to the ceiling. */
function restartDelayMs(attempts: number): number {
  return Math.min(INITIAL_RESTART_DELAY_MS * 2 ** (attempts - 1), MAX_RESTART_DELAY_MS);
}

/**
 * Boot the packed Next app as a managed child and supervise it for the
 * profile's lifetime (ADR-0001: spawn, readiness, backoff restart, tree
 * teardown).
 *
 * @param ctx - plugin context carrying `nextAppCli` and `subprocess`.
 */
export function apply(ctx: Context, config: Config): void {
  // The Config schema validated this at load (per the harness config docs):
  // the port is a positive integer and the auth pair is complete or absent
  // together, so a misconfigured profile refuses to boot half-gated.
  const auth = config.auth;
  // Serving parameters (ADR-0009): invocation flags override the row
  // config, whose defaults the schema filled. An empty configured host
  // counts as unset (the schema keeps it a string; the default applies).
  const host = ctx.nextAppCli?.host ?? (config.host !== "" ? config.host : DEFAULT_HOST);
  const port = ctx.nextAppCli?.port ?? config.port;
  const url = servingUrl(host, port);
  const nextCli = fileURLToPath(import.meta.resolve("next/dist/bin/next"));
  const controller = new AbortController();

  // The bridge socket path (ADR-0003): under the profile's run directory,
  // named per port so two instances of the same profile (different serving
  // ports) never fight over one socket file - each child connects to the
  // exact path its row forwards. Derived at boot, never configured.
  if (ctx.baseUrl === undefined) {
    throw new Error(
      "next-app-runtime: no profile baseUrl - the bridge socket path cannot be derived (is the Loader root missing?)",
    );
  }
  const runDir = join(fileURLToPath(ctx.baseUrl), RUN_DIR_NAME);
  // The per-port filename is a naming contract: the e2e suite pins it
  // (e2e/specs/bridge.spec.ts), so a rename fails loudly there.
  const socketPath = join(runDir, `next-app-${port}.sock`);

  let handle: SubprocessHandle | undefined;
  let stopping = false;
  let attempts = 0;
  let childReady = false;
  let loaderSettled = false;
  let announced = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const announce = (): void => {
    if (announced || stopping) return;
    announced = true;
    console.log(`dsh next-app: ${url}`);
  };

  const readyWarning = setTimeout(() => {
    if (!announced && !stopping) {
      console.warn(
        `next-app-runtime: no ready line from the Next child within ${READY_WARNING_MS / 1000}s; still waiting`,
      );
    }
  }, READY_WARNING_MS);

  const spawnChild = (): void => {
    if (stopping) return;
    if (!existsSync(APP_DIR)) {
      console.error(
        `next-app-runtime: no app build at ${APP_DIR} - the bundle's pack pipeline stages it there`,
      );
    }
    const startedAt = Date.now();
    let lineBuffer = "";
    const child = ctx.subprocess.spawn({
      argv: [process.execPath, nextCli, "start", "--hostname", host, "--port", String(port)],
      cwd: APP_DIR,
      // Explicit env layer: the host service scrubs DSH_* and
      // credential-shaped names from implicit inheritance, and this layer
      // merges after the scrub - the row's auth config travels only when
      // deliberately forwarded (ADR-0008).
      env: {
        ...(auth?.user !== undefined && auth.user !== "" && { DSH_NEXT_APP_USER: auth.user }),
        ...(auth?.passwordHash !== undefined &&
          auth.passwordHash !== "" && {
            DSH_NEXT_APP_PASSWORD_HASH: auth.passwordHash,
          }),
        ...(auth?.realm !== undefined && auth.realm !== "" && { DSH_NEXT_APP_REALM: auth.realm }),
        // DSH_* names are scrubbed from implicit inheritance; the socket
        // path is deliberately forwarded like the auth config (ADR-0003).
        [BRIDGE_SOCKET_ENV]: socketPath,
        // Dev-only mock seam: forwarded only when the operator launched the
        // profile with it (visual testing without a real bridge); scrubbed
        // otherwise, so the child never sees it in production.
        ...(process.env["DSH_NEXT_APP_MOCK_SESSIONS"] !== undefined && {
          DSH_NEXT_APP_MOCK_SESSIONS: process.env["DSH_NEXT_APP_MOCK_SESSIONS"],
        }),
      },
      stdio: { stdin: "ignore", stdout: "pipe", stderr: "inherit" },
      graceMs: TERMINATE_GRACE_MS,
      signal: controller.signal,
    });
    handle = child;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      lineBuffer += chunk;
      for (;;) {
        const newlineIndex = lineBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = lineBuffer.slice(0, newlineIndex);
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        if (!childReady && stripAnsi(line).includes(READY_MARKER)) {
          childReady = true;
          if (loaderSettled) announce();
        }
      }
    });
    child.done.then(
      (outcome) => {
        if (stopping) return;
        attempts = Date.now() - startedAt >= STABLE_UPTIME_MS ? 0 : attempts + 1;
        const delayMs = restartDelayMs(Math.max(attempts, 1));
        console.error(
          `next-app-runtime: Next child exited unexpectedly (exitCode ${String(outcome.exitCode)}, signal ${String(outcome.signal)}); restarting in ${delayMs}ms`,
        );
        restartTimer = setTimeout(spawnChild, delayMs);
      },
      (error: unknown) => {
        if (stopping) return;
        attempts += 1;
        const delayMs = restartDelayMs(attempts);
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `next-app-runtime: spawning the Next child failed (${reason}); retrying in ${delayMs}ms`,
        );
        restartTimer = setTimeout(spawnChild, delayMs);
      },
    );
  };

  const loader = ctx.get("loader") as LoaderLike | undefined;
  const settled = loader?.await();
  if (settled === undefined) {
    loaderSettled = true;
  } else {
    settled.then(
      () => {
        loaderSettled = true;
        if (childReady) announce();
      },
      () => {},
    );
  }

  ctx.effect(async () => {
    // The bridge socket must exist before the child's first request can
    // reach it; the child reconnects with backoff anyway, but a refused
    // first page load would defeat the "no first-load flash" story. A
    // bridge that cannot start (live socket conflict, unboundable path)
    // fails the fiber - the profile refuses to boot half-wired (the child
    // would silently serve a dead data channel). The effect body always
    // returns a disposer (cordis' async-effect contract), so a disposal
    // that raced the bridge startup still stops it.
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    // The typed service face (the apiProxy service's own Context merge
    // declares it; this local keeps the type loaded and in use).
    const api: ApiProxy = ctx.apiProxy;
    const bridge: BridgeServer = await startBridge(api, socketPath).catch((error: unknown) => {
      throw new Error(
        `next-app-runtime: starting the bridge failed (${error instanceof Error ? error.message : String(error)})`,
      );
    });
    if (!stopping) spawnChild();
    return () => {
      stopping = true;
      controller.abort();
      clearTimeout(readyWarning);
      if (restartTimer !== undefined) clearTimeout(restartTimer);
      handle?.terminate();
      bridge.stop();
    };
  });
}
