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
