export type ApiSource = "fixture" | "state-db" | "rollout-cache" | "logs-db";

export type ApiResult<T> =
  | {
      ok: true;
      data: T;
      source: ApiSource;
      warnings: string[];
    }
  | {
      ok: false;
      error: ApiError;
      source: ApiSource;
      warnings: string[];
    };

export interface ApiError {
  code: string;
  message: string;
  detail?: string;
}

export type SessionStatus = "running" | "complete" | "failed" | "paused";

export interface HealthStatus {
  status: "ok";
  mode: "fixture" | "real";
  checkedAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  branch: string;
  cwd: string;
  model: string;
  lastMessage: string;
  childCount: number;
  openChildCount: number;
  tokenTotal: number;
}

export interface ObservatoryApi {
  getHealth(): Promise<ApiResult<HealthStatus>>;
  listSessions(): Promise<ApiResult<SessionSummary[]>>;
}
