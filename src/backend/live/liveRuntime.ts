import { resolveCodexHome } from "../codexPaths";
import { createLiveHub, type LiveHub } from "./liveHub";
import { createLiveSources, type LiveSources } from "./liveSources";
import { createWatchManager, type WatchManager } from "./watchManager";

export interface LiveRuntime {
  hub: LiveHub;
  watchManager: WatchManager;
  sources: LiveSources;
}

let runtime: LiveRuntime | null = null;

export const getLiveRuntime = async (): Promise<LiveRuntime> => {
  if (runtime) return runtime;
  const codexHome = await resolveCodexHome();
  const hub = createLiveHub();
  const watchManager = createWatchManager();
  const sources = createLiveSources({ codexHome, hub, watchManager });
  runtime = { hub, watchManager, sources };
  return runtime;
};

/** Test/shutdown helper: tear everything down and clear the singleton. */
export const resetLiveRuntime = async (): Promise<void> => {
  if (!runtime) return;
  runtime.watchManager.close();
  await runtime.sources.close();
  runtime = null;
};
