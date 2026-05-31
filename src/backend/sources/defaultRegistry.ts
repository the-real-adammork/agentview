import { resolveCodexHome } from "../codexPaths";
import { createCodexSource } from "./codex/CodexSource";
import { createSourceRegistry, type SourceRegistry } from "./registry";

/**
 * Build the per-request source registry, mirroring the existing per-request
 * `openStateStore` lifecycle: each handler constructs a registry, uses it, and
 * `close()`s it in a `finally`. Only Codex is registered this phase, so the
 * merged fan-out is a fan-out of one and behavior is identical to before.
 *
 * The registry's `close()` disposes every registered source (the Codex source
 * closes its lazily-opened read-only state store), preserving the no-shared-handle
 * lifecycle the Codex handlers had in Phase 1.
 */
export const createDefaultRegistry = async (): Promise<SourceRegistry> => {
  const codexHome = await resolveCodexHome();
  return createSourceRegistry([createCodexSource({ codexHome })]);
};
