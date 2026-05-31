import { resolveCodexHome } from "../codexPaths";
import { createDefaultRegistry } from "../sources/defaultRegistry";
import type { SourceRegistry } from "../sources/registry";
import { createLiveHub, type LiveHub } from "./liveHub";
import { createLiveSources, type LiveSources } from "./liveSources";
import { createWatchManager, type WatchManager } from "./watchManager";

export interface LiveRuntime {
  hub: LiveHub;
  watchManager: WatchManager;
  sources: LiveSources;
  registry: SourceRegistry;
}

let runtime: LiveRuntime | null = null;

export const getLiveRuntime = async (): Promise<LiveRuntime> => {
  if (runtime) return runtime;
  const codexHome = await resolveCodexHome();
  // The same registry composition the HTTP handlers use (Codex + Claude Code), so
  // live and HTTP agree on the registered sources. `codexHome` is still passed for
  // the Codex-only sessions/diagnostics/tokens snapshots.
  const registry = await createDefaultRegistry();
  const hub = createLiveHub();
  const watchManager = createWatchManager();
  const sources = createLiveSources({ registry, codexHome, hub, watchManager });
  runtime = { hub, watchManager, sources, registry };
  return runtime;
};

/** Test/shutdown helper: tear everything down and clear the singleton. */
export const resetLiveRuntime = async (): Promise<void> => {
  if (!runtime) return;
  runtime.watchManager.close();
  await runtime.sources.close();
  await runtime.registry.close().catch(() => undefined);
  runtime = null;
};
