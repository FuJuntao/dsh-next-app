import { cookies } from "next/headers";
import { PREFERENCES_COOKIE, parsePreferences, type Preferences } from "./preferences";

/**
 * Read the preferences from the request cookie store (server only).
 * There is no client use case for the read side - the only client reader
 * is updatePreferences' internal merge, which reads the document cookie
 * directly - so this module imports next/headers statically and must only
 * be imported from server components.
 */
export async function readPreferences(): Promise<Preferences | undefined> {
  const store = await cookies();
  return parsePreferences(store.get(PREFERENCES_COOKIE)?.value);
}
