export interface ThreadTitleFields {
  id: string;
  title: string | null;
  firstUserMessage: string | null;
  preview: string | null;
  threadSource: string | null;
  agentRole: string | null;
  agentNickname: string | null;
}

const trim = (value: string | null | undefined) => (value ?? "").trim();

/**
 * Sub-agent threads frequently carry the parent's prompt in their `title` /
 * `first_user_message` columns, so the plain fallback makes every child look
 * like a clone of the parent. Lead sub-agent titles with their own identity
 * (role/nickname) so siblings stay distinct from the parent and each other.
 */
export function deriveSessionTitle(fields: ThreadTitleFields): string {
  const base = trim(fields.title) || trim(fields.firstUserMessage) || trim(fields.preview) || fields.id;

  if (fields.threadSource !== "subagent") {
    return base;
  }

  const identity = [trim(fields.agentRole), trim(fields.agentNickname)].filter(Boolean).join(" · ");
  if (!identity) {
    return base;
  }

  return base && base !== identity ? `${identity} · ${base}` : identity;
}
