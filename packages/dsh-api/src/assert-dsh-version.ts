import { SUPPORTED_DSH_VERSION } from "./version.js";

/**
 * Boot invariant (ADR-0008): fail loudly when the running dsh version
 * is not exactly the version this bundle was tested against. A quiet
 * mismatch corrupts rendering instead of failing the boot.
 */
export function assertDshVersion(actual: string): void {
  if (actual !== SUPPORTED_DSH_VERSION) {
    throw new Error(
      "dsh version mismatch: this bundle supports dsh " +
        SUPPORTED_DSH_VERSION +
        " exactly, but the running dsh is " +
        actual +
        ". Install the matching dsh version or update this bundle (see the README upgrade notes).",
    );
  }
}
