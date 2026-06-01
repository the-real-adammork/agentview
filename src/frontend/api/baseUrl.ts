const DEFAULT_API_BASE_URL = "http://127.0.0.1:4317";

export interface ResolveApiBaseUrlOptions {
  runtimeApiBaseUrl?: string | null;
  envApiBaseUrl?: string | null;
}

const normalizeBaseUrl = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
};

const readRuntimeApiBaseUrl = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.agentview?.apiBaseUrl ?? null;
};

export const resolveApiBaseUrl = ({
  runtimeApiBaseUrl = readRuntimeApiBaseUrl(),
  envApiBaseUrl = import.meta.env.VITE_AGENTVIEW_API_BASE_URL,
}: ResolveApiBaseUrlOptions = {}) =>
  normalizeBaseUrl(runtimeApiBaseUrl) ?? normalizeBaseUrl(envApiBaseUrl) ?? DEFAULT_API_BASE_URL;
