import type { SessionSummary } from "../../shared/contracts";
import { deriveRepoName, repoRootCwd } from "../../shared/repoName";

export type SessionIndex = Map<string, SessionSummary>;

/** Window used to classify a session/repo as "active" in the Repos view (matches the design handoff). */
export const REPO_ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

export const indexSessions = (sessions: SessionSummary[]): SessionIndex =>
  new Map(sessions.map((session) => [session.id, session]));

/** Human-facing repo name: origin-derived label when available, else the cwd basename. */
export const sessionRepoName = (session: SessionSummary): string =>
  session.repoLabel || deriveRepoName(session.gitOriginUrl ?? undefined, session.cwd);

const tokensOf = (session: SessionSummary): number => session.tokensUsed ?? session.tokenTotal ?? 0;
const warningsOf = (session: SessionSummary): number => session.warningCount ?? 0;
const failedOf = (session: SessionSummary): number => session.failedToolCount ?? 0;
export const sessionUpdatedMs = (session: SessionSummary): number =>
  session.updatedAtMs ?? (Date.parse(session.updatedAt) || 0);
export const sessionCreatedMs = (session: SessionSummary): number =>
  session.createdAtMs ?? sessionUpdatedMs(session);

export type SessionSortMode = "created_desc" | "created_asc" | "tokens_desc" | "tokens_asc";

const compareSessions = (sort: SessionSortMode) => (left: SessionSummary, right: SessionSummary): number => {
  switch (sort) {
    case "created_asc":
      return sessionCreatedMs(left) - sessionCreatedMs(right) || left.id.localeCompare(right.id);
    case "tokens_desc":
      return tokensOf(right) - tokensOf(left) || sessionCreatedMs(right) - sessionCreatedMs(left) || left.id.localeCompare(right.id);
    case "tokens_asc":
      return tokensOf(left) - tokensOf(right) || sessionCreatedMs(right) - sessionCreatedMs(left) || left.id.localeCompare(right.id);
    case "created_desc":
    default:
      return sessionCreatedMs(right) - sessionCreatedMs(left) || left.id.localeCompare(right.id);
  }
};

const compareChildSessions = (sort: SessionSortMode) => {
  if (sort === "tokens_desc" || sort === "tokens_asc") {
    return compareSessions(sort);
  }

  return (left: SessionSummary, right: SessionSummary): number =>
    sessionCreatedMs(left) - sessionCreatedMs(right) || left.id.localeCompare(right.id);
};

/** Walks parentId to the topmost ancestor present in the index (cycle/orphan safe). */
export const rootOf = (session: SessionSummary, index: SessionIndex): SessionSummary => {
  let current = session;
  const seen = new Set<string>([current.id]);
  while (current.parentId) {
    const parent = index.get(current.parentId);
    if (!parent || seen.has(parent.id)) {
      break;
    }
    current = parent;
    seen.add(current.id);
  }
  return current;
};

export const isDescendantOf = (session: SessionSummary, ancestorId: string, index: SessionIndex): boolean => {
  let current = session;
  const seen = new Set<string>([current.id]);
  while (current.parentId) {
    if (current.parentId === ancestorId) {
      return true;
    }
    const parent = index.get(current.parentId);
    if (!parent || seen.has(parent.id)) {
      break;
    }
    current = parent;
    seen.add(current.id);
  }
  return false;
};

const isRoot = (session: SessionSummary, index: SessionIndex): boolean => rootOf(session, index).id === session.id;

/** Depth in the agent tree: 0 = root/parent, 1 = sub-agent, 2 = sub-sub-agent, … (cycle/orphan safe). */
export const sessionDepth = (session: SessionSummary, index: SessionIndex): number => {
  let depth = 0;
  let current = session;
  const seen = new Set<string>([current.id]);
  while (current.parentId) {
    const parent = index.get(current.parentId);
    if (!parent || seen.has(parent.id)) {
      depth += 1;
      break;
    }
    depth += 1;
    current = parent;
    seen.add(current.id);
  }
  return depth;
};

/** Ancestor chain ordered root → … → current (always includes `session` as the last element). */
export const sessionLineage = (session: SessionSummary, index: SessionIndex): SessionSummary[] => {
  const chain: SessionSummary[] = [];
  let current: SessionSummary | undefined = session;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  return chain;
};

/** Shared depth → color tone: 0 root (orange/primary) · 1 sub (amber) · 2+ sub-sub (cyan). */
export type DepthTone = "primary" | "amber" | "cyan";
export const toneForDepth = (depth: number): DepthTone =>
  depth <= 0 ? "primary" : depth === 1 ? "amber" : "cyan";

const DEPTH_LABELS = ["PARENT", "SUB-AGENT", "SUB-SUB-AGENT"] as const;
/** Human label for a tree depth, used in the header square and thread navigator. */
export const depthLabel = (depth: number): string => DEPTH_LABELS[depth] ?? `SUB · L${depth}`;

export interface RepoRoot {
  root: SessionSummary;
  subs: SessionSummary[];
  lastActivityMs: number;
}

export interface RepoGroup {
  repoName: string;
  cwd: string;
  branch: string | null;
  gitSha: string | null;
  originPreview: string | null;
  roots: RepoRoot[];
  active: RepoRoot[];
  sessionCount: number;
  totalTokens: number;
  warnings: number;
  failedTools: number;
  openChildren: number;
  lastActivityMs: number;
}

/**
 * Groups sessions into repos keyed by the root parent's repo name, nesting each
 * root's sub-agents beneath it. Sub-agents inherit their root's repo so a worker
 * spawned in the same checkout never splinters into its own repo card.
 */
export const groupSessionsByRepo = (sessions: SessionSummary[], nowMs: number = Date.now()): RepoGroup[] => {
  const index = indexSessions(sessions);
  const byRepo = new Map<string, RepoGroup>();

  for (const root of sessions.filter((session) => isRoot(session, index))) {
    const repoName = sessionRepoName(root);
    let group = byRepo.get(repoName);
    if (!group) {
      group = {
        repoName,
        cwd: repoRootCwd(root.cwd),
        branch: root.gitBranch ?? root.branch ?? null,
        gitSha: root.gitSha ?? null,
        originPreview: root.gitOriginUrlPreview ?? null,
        roots: [],
        active: [],
        sessionCount: 0,
        totalTokens: 0,
        warnings: 0,
        failedTools: 0,
        openChildren: 0,
        lastActivityMs: 0,
      };
      byRepo.set(repoName, group);
    }

    const subs = sessions
      .filter((session) => session.id !== root.id && isDescendantOf(session, root.id, index))
      .sort((left, right) => sessionUpdatedMs(right) - sessionUpdatedMs(left));
    const members = [root, ...subs];
    const lastActivityMs = Math.max(...members.map(sessionUpdatedMs));

    group.roots.push({ root, subs, lastActivityMs });
    group.sessionCount += members.length;
    group.totalTokens += members.reduce((total, session) => total + tokensOf(session), 0);
    group.warnings += members.reduce((total, session) => total + warningsOf(session), 0);
    group.failedTools += members.reduce((total, session) => total + failedOf(session), 0);
    group.openChildren += members.reduce((total, session) => total + session.openChildCount, 0);
    group.lastActivityMs = Math.max(group.lastActivityMs, lastActivityMs);
  }

  for (const group of byRepo.values()) {
    group.roots.sort((left, right) => right.lastActivityMs - left.lastActivityMs);
    group.active = group.roots.filter((repoRoot) => nowMs - repoRoot.lastActivityMs <= REPO_ACTIVE_WINDOW_MS);
  }

  return Array.from(byRepo.values()).sort(
    (left, right) => right.active.length - left.active.length || right.lastActivityMs - left.lastActivityMs,
  );
};

export interface TreeRow {
  session: SessionSummary;
  depth: number;
}

/**
 * Flattens the entire agent tree that contains `current`, rooted at its topmost
 * ancestor, depth-first and ordered by spawn time. Lets the Timeline sidebar show
 * (and jump to) the root, siblings, and descendants from any node in the tree.
 */
export const flattenAgentTree = (current: SessionSummary, sessions: SessionSummary[]): TreeRow[] => {
  const index = indexSessions(sessions);
  const root = rootOf(current, index);
  const childrenOf = (parentId: string) =>
    sessions
      .filter((session) => session.parentId === parentId)
      .sort((left, right) => (left.createdAtMs ?? sessionUpdatedMs(left)) - (right.createdAtMs ?? sessionUpdatedMs(right)));

  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (node: SessionSummary, depth: number) => {
    if (seen.has(node.id)) {
      return;
    }
    seen.add(node.id);
    rows.push({ session: node, depth });
    for (const child of childrenOf(node.id)) {
      walk(child, depth + 1);
    }
  };
  walk(root, sessionDepth(root, index));
  return rows;
};

export interface SessionRow {
  session: SessionSummary;
  depth: number;
  matched: boolean;
  isLastSub: boolean;
}

/**
 * Produces a tree-ordered row list: roots (newest first) each followed by their
 * descendants at depth 1. A matched sub-agent always pulls its ancestors into the
 * list so the tree stays connected even when only the child matched the filter.
 */
export const buildSessionRows = (
  sessions: SessionSummary[],
  matchPredicate: (session: SessionSummary) => boolean,
  sort: SessionSortMode = "created_desc",
): SessionRow[] => {
  const index = indexSessions(sessions);
  const matched = sessions.filter(matchPredicate);
  const matchedIds = new Set(matched.map((session) => session.id));
  const visibleIds = new Set(matchedIds);

  for (const session of matched) {
    let current = session;
    const seen = new Set<string>([current.id]);
    while (current.parentId) {
      const parent = index.get(current.parentId);
      if (!parent || seen.has(parent.id)) {
        break;
      }
      visibleIds.add(parent.id);
      current = parent;
      seen.add(current.id);
    }
  }

  const visible = sessions.filter((session) => visibleIds.has(session.id));
  const roots = visible
    .filter((session) => isRoot(session, index))
    .sort(compareSessions(sort));

  // Walk each root's subtree depth-first so every node carries its TRUE depth
  // (sub-sub-agents are depth 2, etc.) — matching the timeline's Agent Tree.
  // Children stay under their parent. Created-time sorts preserve spawn order
  // within each sibling group; token sorts rank siblings by token count.
  const childrenOf = (parentId: string) =>
    visible
      .filter((session) => session.parentId === parentId)
      .sort(compareChildSessions(sort));

  const rows: SessionRow[] = [];
  const seen = new Set<string>();
  const walk = (node: SessionSummary, depth: number, isLastSub: boolean) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    rows.push({ session: node, depth, matched: matchedIds.has(node.id), isLastSub });
    const children = childrenOf(node.id);
    children.forEach((child, childIndex) => walk(child, depth + 1, childIndex === children.length - 1));
  };
  for (const root of roots) {
    walk(root, sessionDepth(root, index), false);
  }

  return rows;
};
