import type { ArchivedFilter, SourceId } from "../shared/contracts";
import type { ObservatoryView } from "./App";

/**
 * The slice of app state that the URL encodes, so a refresh / bookmark / shared
 * link restores the same page. `routing.ts` is pure (no React, no globals): the
 * App seeds its state from `parseLocation` on mount and mirrors state back to the
 * URL with `buildPath`. Keeping it pure makes the whole scheme round-trip testable.
 */
export interface RouteState {
  view: ObservatoryView;
  /** Repo scoping the Sessions list; null = all repos. */
  repo: string | null;
  /** Open session for the detail views (Timeline/Agent Graph/Tokens/Diagnostics). */
  sessionId: string | null;
  /**
   * Tool the open session belongs to, so a deep-linked Claude Code session
   * dispatches correctly on reload. Omitted from the URL for the default ("codex"),
   * keeping existing Codex links unchanged; undefined when no session is open.
   */
  source: SourceId | undefined;
  /** Sessions-list search query ("" = none). */
  search: string;
  /** Sessions-list archived filter; undefined = the default ("exclude"). */
  archived: ArchivedFilter | undefined;
  /** Timeline event scope. */
  scope: "this" | "all";
  /** Timeline event-kind filter ("all" = no filter). */
  kind: string;
}

const VIEW_TO_SLUG: Record<string, string> = {
  Timeline: "timeline",
  "Agent Graph": "graph",
  Tokens: "tokens",
  Diagnostics: "diagnostics",
};
const SLUG_TO_VIEW: Record<string, ObservatoryView> = {
  timeline: "Timeline",
  graph: "Agent Graph",
  tokens: "Tokens",
  diagnostics: "Diagnostics",
};
const ARCHIVED_VALUES: ArchivedFilter[] = ["include", "exclude", "only"];
const SOURCE_VALUES: SourceId[] = ["codex", "claude-code"];
const parseSourceId = (value: string | null): SourceId | undefined =>
  SOURCE_VALUES.includes(value as SourceId) ? (value as SourceId) : undefined;
const isDetailView = (view: ObservatoryView): boolean => view in VIEW_TO_SLUG;

const DEFAULTS: Omit<RouteState, "view" | "repo" | "sessionId" | "source"> = {
  search: "",
  archived: undefined,
  scope: "this",
  kind: "all",
};

/** Parse `window.location` (pathname + search) into a RouteState. */
export function parseLocation(location: { pathname: string; search: string }): RouteState {
  const segments = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(location.search);
  const archivedParam = params.get("archived");
  const filters = {
    search: params.get("q") ?? "",
    archived: ARCHIVED_VALUES.includes(archivedParam as ArchivedFilter) ? (archivedParam as ArchivedFilter) : undefined,
    scope: params.get("scope") === "all" ? ("all" as const) : ("this" as const),
    kind: params.get("kind") ?? "all",
  };

  if (segments[0] === "repos") {
    return { view: "Repos", repo: null, sessionId: null, source: undefined, ...filters };
  }
  if (segments[0] === "repo" && segments[1]) {
    return { view: "Sessions", repo: segments[1], sessionId: null, source: undefined, ...filters };
  }
  if (segments[0] === "session" && segments[1]) {
    const view = (segments[2] && SLUG_TO_VIEW[segments[2]]) || "Timeline";
    return { view, repo: null, sessionId: segments[1], source: parseSourceId(params.get("sourceId")), ...filters };
  }
  return { view: "Sessions", repo: null, sessionId: null, source: undefined, ...filters };
}

/** Serialize a RouteState into a path (+ query string), omitting default values. */
export function buildPath(state: RouteState): string {
  let pathname = "/";
  if (isDetailView(state.view) && state.sessionId) {
    pathname = `/session/${encodeURIComponent(state.sessionId)}/${VIEW_TO_SLUG[state.view]}`;
  } else if (state.view === "Repos") {
    pathname = "/repos";
  } else if (state.repo) {
    pathname = `/repo/${encodeURIComponent(state.repo)}`;
  }

  const params = new URLSearchParams();
  // List filters belong to the Sessions list (repo-scoped or all), not Repos/detail.
  if (state.view === "Sessions") {
    if (state.search) params.set("q", state.search);
    if (state.archived && state.archived !== "exclude") params.set("archived", state.archived);
  }
  if (state.view === "Timeline" && state.sessionId) {
    if (state.scope !== DEFAULTS.scope) params.set("scope", state.scope);
    if (state.kind !== DEFAULTS.kind) params.set("kind", state.kind);
  }
  // Carry the tool for any session detail view so a Claude Code deep-link reloads
  // against the right source. Omitted for the default ("codex") — existing Codex
  // links stay byte-identical.
  if (isDetailView(state.view) && state.sessionId && state.source && state.source !== "codex") {
    params.set("sourceId", state.source);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
