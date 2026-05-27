import { access } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  DiagnosticsSummary,
  RuntimeLog,
  RuntimeLogLevel,
  RuntimeLogPage,
  RuntimeLogQuery,
} from "../../shared/contracts";
import { maskPreviewSecrets } from "../../shared/redaction";

export class LogStoreError extends Error {
  code: string;
  missing?: string[];

  constructor(code: string, message: string, missing?: string[]) {
    super(message);
    this.name = "LogStoreError";
    this.code = code;
    this.missing = missing;
  }
}

export interface LogStoreHealth {
  ok: true;
  source: "logs-db";
  schema: {
    readOnly: true;
    supported: true;
    tables: string[];
  };
}

export interface LogStore {
  getHealth(): Promise<LogStoreHealth>;
  queryLogs(query?: RuntimeLogQuery): Promise<RuntimeLogPage>;
  getDiagnosticsSummary(options?: { threadIds?: string[]; targetLimit?: number }): Promise<DiagnosticsSummary>;
  close(): Promise<void>;
}

interface LogRow {
  id: number | bigint;
  timestamp_ms: number;
  timestamp_nanos: number | null;
  level: RuntimeLogLevel;
  target: string;
  body: string;
  module_path: string | null;
  file: string | null;
  line: number | null;
  thread_id: string | null;
  scope: string | null;
  process_uuid: string | null;
  estimated_bytes: number | null;
  cursor_ts: number;
  cursor_ts_nanos: number | null;
}

interface SummaryRow {
  level: RuntimeLogLevel;
  target: string;
  thread_id: string | null;
  tool_name: string | null;
  command: string | null;
  exit_code: number | null;
  output_preview: string | null;
}

const requiredLogColumns = [
  "id",
  "timestamp_ms",
  "level",
  "target",
  "body",
  "module_path",
  "file",
  "line",
  "thread_id",
  "scope",
  "process_uuid",
  "tool_name",
  "command",
  "exit_code",
  "output_preview",
];

const requiredObservedLogColumns = [
  "id",
  "ts",
  "ts_nanos",
  "level",
  "target",
  "feedback_log_body",
  "module_path",
  "file",
  "line",
  "thread_id",
  "process_uuid",
  "estimated_bytes",
];

type LogSchema =
  | {
      kind: "legacy";
      tables: string[];
      logSelect: string;
      summarySelect: string;
      orderBy: string;
      cursorCondition: string;
      encodeCursor(row: LogRow): string;
      bindCursor(parameters: Record<string, string | number>, cursor: LogCursor): boolean;
      scopeFilterColumn: string | null;
    }
  | {
      kind: "observed";
      tables: string[];
      logSelect: string;
      summarySelect: string;
      orderBy: string;
      cursorCondition: string;
      encodeCursor(row: LogRow): string;
      bindCursor(parameters: Record<string, string | number>, cursor: LogCursor): boolean;
      scopeFilterColumn: null;
    };

interface LogCursor {
  timestampMs?: number;
  ts?: number;
  tsNanos?: number;
  id: number;
}

const warningLevels = new Set<RuntimeLogLevel>(["WARN", "ERROR"]);
const allowedLevels = new Set<RuntimeLogLevel>(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);

const collectTables = (db: DatabaseSync) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String((row as { name: unknown }).name));

const collectColumns = (db: DatabaseSync, table: string) =>
  new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );

const missingColumns = (columns: Set<string>, requiredColumns: string[]) =>
  requiredColumns.filter((column) => !columns.has(column)).map((column) => `logs.${column}`);

const validateSchema = (db: DatabaseSync): LogSchema => {
  const tables = collectTables(db);
  const missing: string[] = [];

  if (!tables.includes("logs")) {
    missing.push("logs");
  } else {
    const columns = collectColumns(db, "logs");
    const missingLegacy = missingColumns(columns, requiredLogColumns);
    if (missingLegacy.length === 0) {
      return {
        kind: "legacy",
        tables,
        logSelect: `
          id,
          timestamp_ms,
          NULL AS timestamp_nanos,
          level,
          target,
          body,
          module_path,
          file,
          line,
          thread_id,
          scope,
          process_uuid,
          NULL AS estimated_bytes,
          timestamp_ms AS cursor_ts,
          NULL AS cursor_ts_nanos
        `,
        summarySelect: "level, target, thread_id, tool_name, command, exit_code, output_preview",
        orderBy: "timestamp_ms DESC, id DESC",
        cursorCondition: "(timestamp_ms < :cursorTimestampMs OR (timestamp_ms = :cursorTimestampMs AND id < :cursorId))",
        encodeCursor: (row) => encodeCursor({ timestampMs: row.cursor_ts, id: Number(row.id) }),
        bindCursor: (parameters, cursor) => {
          if (typeof cursor.timestampMs !== "number") return false;
          parameters.cursorTimestampMs = cursor.timestampMs;
          parameters.cursorId = cursor.id;
          return true;
        },
        scopeFilterColumn: "scope",
      };
    }

    const missingObserved = missingColumns(columns, requiredObservedLogColumns);
    if (missingObserved.length === 0) {
      return {
        kind: "observed",
        tables,
        logSelect: `
          id,
          (ts * 1000) + CAST(ts_nanos / 1000000 AS INTEGER) AS timestamp_ms,
          ts_nanos AS timestamp_nanos,
          level,
          target,
          feedback_log_body AS body,
          module_path,
          file,
          line,
          thread_id,
          NULL AS scope,
          process_uuid,
          estimated_bytes,
          ts AS cursor_ts,
          ts_nanos AS cursor_ts_nanos
        `,
        summarySelect: `
          level,
          target,
          thread_id,
          NULL AS tool_name,
          NULL AS command,
          NULL AS exit_code,
          NULL AS output_preview
        `,
        orderBy: "ts DESC, ts_nanos DESC, id DESC",
        cursorCondition: `
          (
            ts < :cursorTs
            OR (ts = :cursorTs AND ts_nanos < :cursorTsNanos)
            OR (ts = :cursorTs AND ts_nanos = :cursorTsNanos AND id < :cursorId)
          )
        `,
        encodeCursor: (row) =>
          encodeCursor({
            ts: row.cursor_ts,
            tsNanos: row.cursor_ts_nanos ?? 0,
            id: Number(row.id),
          }),
        bindCursor: (parameters, cursor) => {
          if (typeof cursor.ts !== "number" || typeof cursor.tsNanos !== "number") return false;
          parameters.cursorTs = cursor.ts;
          parameters.cursorTsNanos = cursor.tsNanos;
          parameters.cursorId = cursor.id;
          return true;
        },
        scopeFilterColumn: null,
      };
    }

    missing.push(...missingLegacy);
  }

  if (missing.length > 0) {
    throw new LogStoreError(
      "SCHEMA_UNSUPPORTED",
      `Unsupported logs_2.sqlite schema: missing ${missing.join(", ")}`,
      missing,
    );
  }

  throw new LogStoreError("SCHEMA_UNSUPPORTED", "Unreachable schema validation state.");
};

const encodeCursor = (cursor: LogCursor) => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

const decodeCursor = (cursor: string) => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      timestampMs?: unknown;
      ts?: unknown;
      tsNanos?: unknown;
      id?: unknown;
    };
    if (typeof parsed.id !== "number") {
      return null;
    }
    if (typeof parsed.timestampMs === "number") {
      return { timestampMs: parsed.timestampMs, id: parsed.id };
    }
    if (typeof parsed.ts === "number" && typeof parsed.tsNanos === "number") {
      return { ts: parsed.ts, tsNanos: parsed.tsNanos, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
};

const normalizePreview = (value: string) => {
  const redacted = maskPreviewSecrets(value.replace(/\s+/g, " ").trim(), { includeMetadata: true });
  return {
    text: redacted.text.length > 1200 ? `${redacted.text.slice(0, 1200)}...` : redacted.text,
    redactionApplied: redacted.redactionApplied,
  };
};

const normalizeLog = (row: LogRow): RuntimeLog => {
  const preview = normalizePreview(row.body);
  return {
    id: `log-${Number(row.id)}`,
    timestampMs: row.timestamp_ms,
    timestampNanos: row.timestamp_nanos ?? undefined,
    level: row.level,
    target: row.target,
    bodyPreview: preview.text,
    modulePath: row.module_path ?? undefined,
    file: row.file ?? undefined,
    line: row.line ?? undefined,
    threadId: row.thread_id ?? undefined,
    scope: row.scope ?? undefined,
    processUuid: row.process_uuid ?? undefined,
    estimatedBytes: row.estimated_bytes ?? Buffer.byteLength(row.body, "utf8"),
    redactionApplied: preview.redactionApplied,
  };
};

const addOptionalFilter = (
  conditions: string[],
  parameters: Record<string, string | number>,
  column: string,
  parameterName: string,
  value: string | undefined,
) => {
  if (value === undefined || value.trim() === "") {
    return;
  }
  conditions.push(`${column} = :${parameterName}`);
  parameters[parameterName] = value;
};

const rowsForSummary = (db: DatabaseSync, schema: LogSchema, threadIds: string[]) => {
  const parameters: Record<string, string> = {};
  const conditions: string[] = [];

  if (threadIds.length > 0) {
    const placeholders = threadIds.map((threadId, index) => {
      const key = `threadId${index}`;
      parameters[key] = threadId;
      return `:${key}`;
    });
    conditions.push(`thread_id IN (${placeholders.join(", ")})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .prepare(
      `
        SELECT ${schema.summarySelect}
        FROM logs
        ${where}
      `,
    )
    .all(parameters) as unknown as SummaryRow[];
};

export const summarizeLogRows = (
  rows: SummaryRow[],
  options: { threadIds?: string[]; targetLimit?: number } = {},
): DiagnosticsSummary => {
  const byThreadId: Record<string, number> = {};
  const byLevel: Partial<Record<RuntimeLogLevel, number>> = {};
  const targetCounts = new Map<string, { target: string; totalCount: number; warningCount: number; errorCount: number }>();
  const failedByKey = new Map<
    string,
    {
      threadId: string;
      toolName: string;
      command: string;
      exitCode: number;
      count: number;
      lastOutputPreview: string;
      source: "logs-db";
    }
  >();
  const failedCountsByThread = new Map<string, number>();

  for (const row of rows) {
    const level = row.level;
    const isWarning = warningLevels.has(level);
    if (isWarning) {
      byLevel[level] = (byLevel[level] ?? 0) + 1;
      if (row.thread_id) {
        byThreadId[row.thread_id] = (byThreadId[row.thread_id] ?? 0) + 1;
      }

      const target = targetCounts.get(row.target) ?? {
        target: row.target,
        totalCount: 0,
        warningCount: 0,
        errorCount: 0,
      };
      target.totalCount += 1;
      if (level === "ERROR") target.errorCount += 1;
      else target.warningCount += 1;
      targetCounts.set(row.target, target);
    }

    if (row.thread_id && row.tool_name && row.command && row.exit_code !== null && row.exit_code !== 0) {
      const key = `${row.thread_id}\u0000${row.tool_name}\u0000${row.command}\u0000${row.exit_code}`;
      const output = normalizePreview(row.output_preview ?? "").text;
      const failed = failedByKey.get(key) ?? {
        threadId: row.thread_id,
        toolName: row.tool_name,
        command: row.command,
        exitCode: row.exit_code,
        count: 1,
        lastOutputPreview: output,
        source: "logs-db" as const,
      };
      failed.lastOutputPreview = output || failed.lastOutputPreview;
      failedByKey.set(key, failed);
    }
  }

  for (const failed of failedByKey.values()) {
    failedCountsByThread.set(failed.threadId, (failedCountsByThread.get(failed.threadId) ?? 0) + failed.count);
  }

  const threadIds = options.threadIds?.length
    ? options.threadIds
    : [...new Set(rows.map((row) => row.thread_id).filter((threadId): threadId is string => Boolean(threadId)))];
  return {
    warningCounts: {
      total: Object.values(byLevel).reduce((total, count) => total + (count ?? 0), 0),
      byThreadId,
      byLevel,
    },
    loudestTargets: [...targetCounts.values()]
      .sort((left, right) => right.totalCount - left.totalCount || left.target.localeCompare(right.target))
      .slice(0, options.targetLimit ?? 5),
    failedCommands: [...failedByKey.values()].sort(
      (left, right) => right.count - left.count || left.threadId.localeCompare(right.threadId),
    ),
    sessionsWarningBadges: threadIds.map((threadId) => ({
      threadId,
      warningCountStatus: "ready" as const,
      warningCount: byThreadId[threadId] ?? 0,
      failedToolCountStatus: "ready" as const,
      failedToolCount: failedCountsByThread.get(threadId) ?? 0,
    })),
  };
};

export const openLogStore = async ({ codexHome }: { codexHome: string }): Promise<LogStore> => {
  const logsDbPath = join(codexHome, "logs_2.sqlite");

  try {
    await access(logsDbPath);
  } catch (error) {
    throw new LogStoreError(
      "LOGS_DB_MISSING",
      `Unable to access logs_2.sqlite at ${logsDbPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const db = new DatabaseSync(logsDbPath, { readOnly: true });
  let schema: LogSchema;

  try {
    schema = validateSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const store: LogStore = {
    async getHealth() {
      return {
        ok: true,
        source: "logs-db",
        schema: {
          readOnly: true,
          supported: true,
          tables: schema.tables,
        },
      };
    },
    async queryLogs(query = {}) {
      const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
      const conditions: string[] = [];
      const parameters: Record<string, string | number> = { limit: limit + 1 };

      if (query.level) {
        if (!allowedLevels.has(query.level)) {
          throw new LogStoreError("INVALID_FILTER", `Unsupported log level: ${query.level}`);
        }
        conditions.push("level = :level");
        parameters.level = query.level;
      }

      addOptionalFilter(conditions, parameters, "target", "target", query.target);
      addOptionalFilter(conditions, parameters, "thread_id", "threadId", query.threadId);
      if (schema.scopeFilterColumn) {
        addOptionalFilter(conditions, parameters, schema.scopeFilterColumn, "scope", query.scope);
      }

      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        if (!cursor || !schema.bindCursor(parameters, cursor)) {
          throw new LogStoreError("INVALID_CURSOR", "Log cursor is invalid.");
        }
        conditions.push(schema.cursorCondition);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = db
        .prepare(
          `
            SELECT ${schema.logSelect}
            FROM logs
            ${where}
            ORDER BY ${schema.orderBy}
            LIMIT :limit
          `,
        )
        .all(parameters) as unknown as LogRow[];
      const pageRows = rows.slice(0, limit);
      const last = pageRows.at(-1);

      return {
        logs: pageRows.map(normalizeLog),
        nextCursor: rows.length > limit && last ? schema.encodeCursor(last) : null,
      };
    },
    async getDiagnosticsSummary(options = {}) {
      return summarizeLogRows(rowsForSummary(db, schema, options.threadIds ?? []), options);
    },
    async close() {
      db.close();
    },
  };

  return store;
};
