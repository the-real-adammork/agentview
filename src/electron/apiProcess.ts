import { fork } from "node:child_process";
import { join } from "node:path";
import type { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

type ApiReadyMessage = {
  type: "agentview-api-ready";
  baseUrl: string;
};

type ApiErrorMessage = {
  type: "agentview-api-error";
  message: string;
};

type ApiProcessMessage = ApiReadyMessage | ApiErrorMessage;

export interface RunningAgentViewApiProcess {
  baseUrl: string;
  close(): void;
}

type ForkedProcess = Pick<EventEmitter, "on" | "once" | "off"> & {
  stdout?: EventEmitter | null;
  stderr?: EventEmitter | null;
  killed?: boolean;
  kill(signal?: NodeJS.Signals): boolean | void;
};

export interface StartAgentViewApiProcessOptions {
  entryPath?: string;
  forkProcess?: (entryPath: string) => ForkedProcess;
}

export const defaultAgentViewApiChildPath = () => join(__dirname, "apiChild.cjs");

const isApiProcessMessage = (message: unknown): message is ApiProcessMessage => {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Partial<ApiProcessMessage>;
  return candidate.type === "agentview-api-ready" || candidate.type === "agentview-api-error";
};

export const startAgentViewApiProcess = ({
  entryPath = defaultAgentViewApiChildPath(),
  forkProcess = (path) =>
    fork(path, {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    }) as ChildProcess,
}: StartAgentViewApiProcessOptions = {}): Promise<RunningAgentViewApiProcess> =>
  new Promise((resolve, reject) => {
    const child = forkProcess(entryPath);
    const output: string[] = [];

    child.stdout?.on("data", (chunk) => {
      output.push(String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      output.push(String(chunk));
    });

    const cleanup = () => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const rejectWith = (message: string) => {
      cleanup();
      reject(new Error(`${message}${output.length ? `\n${output.join("")}` : ""}`));
    };

    const onMessage = (message: unknown) => {
      if (!isApiProcessMessage(message)) return;

      if (message.type === "agentview-api-error") {
        rejectWith(message.message);
        return;
      }

      cleanup();
      resolve({
        baseUrl: message.baseUrl,
        close() {
          if (!child.killed) {
            child.kill("SIGTERM");
          }
        },
      });
    };

    const onError = (error: Error) => {
      rejectWith(error.message);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      rejectWith(`AgentView API process exited before startup (${signal ?? code ?? "unknown"}).`);
    };

    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
