/**
 * Server-side option data for the home composer's picker chips
 * (story #117 task #121; the model catalog joins with task #125).
 *
 * The rosters are deployment facts, not per-request user data, so the home
 * page awaits them server-side (same data flow as the side nav's session
 * fetch, story #107) and passes them down to the client island. A bridge
 * that is down or answers with an error yields an empty roster - the picker
 * hides itself rather than lying about what can be chosen; the send path
 * still reports the bridge-down state on its own.
 */
import type { AgentPresetEntry, ModelProviderGroup } from "@deepseek-ai/dsh-host-apiproxy/api";
import { getBridgeClient } from "./bridge";

/** Every preset the deployment supplies, in roster order ([] when unavailable). */
export async function fetchAgentPresets(): Promise<AgentPresetEntry[]> {
  try {
    const response = await getBridgeClient().agentPresets.list({});
    if (!response.result.ok) {
      console.error(
        `[home-composer-data] agentPreset.list failed: ${response.result.error.code} ${response.result.error.message}`,
      );
      return [];
    }
    return [...response.result.value.presets];
  } catch (error) {
    console.error("[home-composer-data] agentPreset.list failed:", error);
    return [];
  }
}

/**
 * The host-scoped model catalog for the model picker (story #117 task
 * #125): provider groups, models, and reasoning efforts where offered.
 * Per-provider lookup failures ride the contract's `failures` list - they
 * are logged and dropped, since a sound group is still selectable.
 */
export async function fetchModelCatalog(): Promise<ModelProviderGroup[]> {
  try {
    const response = await getBridgeClient().llm.models({});
    if (!response.result.ok) {
      console.error(
        `[home-composer-data] llm.models failed: ${response.result.error.code} ${response.result.error.message}`,
      );
      return [];
    }
    const { groups, failures } = response.result.value;
    for (const failure of failures) {
      console.error(
        `[home-composer-data] llm.models provider ${failure.id} listing failed: ${failure.message}`,
      );
    }
    return groups.map((group) => ({ ...group, models: [...group.models] }));
  } catch (error) {
    console.error("[home-composer-data] llm.models failed:", error);
    return [];
  }
}

/** The default model target: provider, model, and configured effort. */
export type HostModelDefault = {
  provider: string;
  model: string;
  /** The effort the deployment configured, when it named one. */
  reasoningEffort?: string;
};

/**
 * The deployment's default model target for the picker's default entry
 * (task #125 follow-ups). `host.describe` answers the provider/model a
 * session with no explicit selection gets; the thinking effort lives one
 * layer up: the `agent-default-model` settings namespace carries the
 * configured value (settings.describe returns the redacted RESOLVED value,
 * and no secret field lives in that namespace). reasoningEffort stays
 * absent when neither source names one - the UI then shows the model
 * alone, which is the honest answer (the adapter defers to provider
 * behavior). null when the bridge is down or the host has no default.
 */
export async function fetchHostModelDefault(): Promise<HostModelDefault | null> {
  try {
    const [described, settings] = await Promise.all([
      getBridgeClient().host.describe({}),
      getBridgeClient().settings.describe({}),
    ]);
    if (!described.result.ok) {
      console.error(
        `[home-composer-data] host.describe failed: ${described.result.error.code} ${described.result.error.message}`,
      );
      return null;
    }
    const { provider, model } = described.result.value;
    if (provider === undefined || model === undefined) {
      return null;
    }
    const target: HostModelDefault = { provider, model };
    if (settings.result.ok) {
      const ns = settings.result.value.namespaces.find((row) => row.ns === "agent-default-model");
      const value = ns?.value as { reasoningEffort?: unknown } | undefined;
      if (typeof value?.reasoningEffort === "string" && value.reasoningEffort !== "") {
        target.reasoningEffort = value.reasoningEffort;
      }
    } else {
      console.error(
        `[home-composer-data] settings.describe failed: ${settings.result.error.code} ${settings.result.error.message}`,
      );
    }
    return target;
  } catch (error) {
    console.error("[home-composer-data] host.describe failed:", error);
    return null;
  }
}
