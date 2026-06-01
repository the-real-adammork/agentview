import { startAgentViewApi, type RunningAgentViewApi } from "../backend/server";

let api: RunningAgentViewApi | null = null;
let closing = false;

const send = (message: unknown) => {
  if (typeof process.send === "function") {
    process.send(message);
  }
};

const closeApi = async () => {
  if (closing) return;
  closing = true;
  const runningApi = api;
  api = null;
  await runningApi?.close().catch((error) => {
    console.error("Failed to close AgentView API child server.", error);
  });
};

const start = async () => {
  try {
    api = await startAgentViewApi({ port: 0 });
    send({ type: "agentview-api-ready", baseUrl: api.baseUrl });
  } catch (error) {
    send({
      type: "agentview-api-error",
      message: error instanceof Error ? error.message : "Unknown AgentView API startup error.",
    });
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => {
  void closeApi().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void closeApi().finally(() => process.exit(0));
});

process.once("disconnect", () => {
  void closeApi().finally(() => process.exit(0));
});

void start();
