import type { SourceId } from "../../shared/contracts";

/**
 * The `SourceId` dispatch discriminator travels on the wire as the `sourceId`
 * query param (NOT `source`, which `/api/sessions` already uses for the
 * `threadSource` axis). Absent/empty ⇒ default `"codex"` (back-compat); any value
 * outside the `SourceId` union ⇒ a typed `{ ok: false }` the handlers map to 400.
 * Whether a valid `SourceId` is actually registered is the registry's concern.
 */
const sourceIdValues = new Set<SourceId>(["codex", "claude-code"]);

export type ParseSourceIdResult = { ok: true; source: SourceId } | { ok: false; message: string };

export const parseSourceId = (url: URL): ParseSourceIdResult => {
  const raw = url.searchParams.get("sourceId");
  if (raw === null || raw.trim() === "") {
    return { ok: true, source: "codex" };
  }

  if (!sourceIdValues.has(raw as SourceId)) {
    return { ok: false, message: `sourceId has unsupported value: ${raw}.` };
  }

  return { ok: true, source: raw as SourceId };
};
