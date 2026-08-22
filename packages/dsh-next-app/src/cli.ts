/**
 * next-app-startup - the next-app profile's command-line provider.
 *
 * Parses the `dsh --profile next-app` flag family (`--host`, `--port`) and
 * its `--help` text, then provides the immutable values as the
 * {@link NEXT_APP_CLI_SERVICE} service, which the runtime row injects
 * before reading (ADR-0001). The flag-parsing shape is ported from the
 * in-box `@deepseek-ai/dsh-web-app/startup` with attribution - porting
 * in-box code with attribution is this repo's sanctioned pattern.
 *
 * Import surface: host packages only, resolved from the user's dsh
 * installation as peerDependencies (ADR-0002).
 *
 * @module @scope/dsh-next-app/cli
 */
import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
import type { Context } from "@deepseek-ai/cordis";

/** Stable Cordis plugin name. */
export const name = "next-app-cli";

/** Services required before the flags can be resolved. */
export const inject = ["cmdlineArgs"];

/** Service provided by this ordinary plugin and injected by the runtime row. */
export const NEXT_APP_CLI_SERVICE = "nextAppCli";

/** What the next-app rows read from {@link NEXT_APP_CLI_SERVICE}. */
export interface NextAppCliValues {
  /** `--host`, absent when the invocation did not name one. */
  host?: string;
  /** `--port`, absent when the invocation did not name one. */
  port?: number;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** The parsed next-app invocation; provided once the flags parse. */
    nextAppCli?: NextAppCliValues;
  }
}

/**
 * This app's command: its flags, its description, and its help text.
 *
 * @returns a fresh program, so one process can parse more than once.
 */
function nextAppCommand(): Command {
  return new Command()
    .name("dsh --profile next-app")
    .description("Serve the dsh-next-app Next.js surface.")
    .helpOption("-h, --help", "show this help")
    .option(
      "--host <host>",
      "bind host (default 127.0.0.1; 0.0.0.0 binds all interfaces - the v1 surface is unguarded until the auth story lands)",
    )
    .option("--port <port>", "listen port; a positive integer (default 3080)")
    .addHelpText(
      "after",
      `
Examples:
  dsh --profile next-app                          serve on 127.0.0.1:3080
  dsh --profile next-app --port 8080              serve on another port
  dsh --profile next-app --host 0.0.0.0           bind all interfaces (unguarded v1)
`,
    );
}

/**
 * Parse and provide the next-app invocation as an ordinary Cordis service.
 * The command's action publishes the flags this invocation named; a `--port`
 * that is not a positive integer is a usage error, so on rejection (and on
 * `--help`) nothing is provided and the runtime row never starts.
 *
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = nextAppCommand();
  program.action(() => {
    const options = program.opts();
    const host = options["host"] as string | undefined;
    const port = options["port"] as string | undefined;
    if (port !== undefined && !/^[1-9]\d*$/.test(port)) {
      program.error(`error: --port must be a positive integer, got ${JSON.stringify(port)}`);
    }
    ctx.provide(NEXT_APP_CLI_SERVICE, {
      ...(host !== undefined && { host }),
      ...(port !== undefined && { port: Number(port) }),
    });
  });
  parseCmdline(ctx, program);
}
