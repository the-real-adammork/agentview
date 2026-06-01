import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";

import { startAgentViewApi, type RunningAgentViewApi } from "../backend/server";

let mainWindow: BrowserWindow | null = null;
let api: RunningAgentViewApi | null = null;

const isDevelopment = () => process.env.AGENTVIEW_ELECTRON_DEV === "1" || !app.isPackaged;

const rendererDevUrl = () => process.env.AGENTVIEW_RENDERER_URL ?? "http://127.0.0.1:5173";

const createMainWindow = async (apiBaseUrl: string) => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: "AgentView",
    webPreferences: {
      additionalArguments: [`--agentview-api-base-url=${encodeURIComponent(apiBaseUrl)}`],
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      sandbox: false,
    },
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDevelopment()) {
    await mainWindow.loadURL(rendererDevUrl());
    return;
  }

  await mainWindow.loadFile(join(__dirname, "../dist/index.html"));
};

const shutdownApi = () => {
  const runningApi = api;
  api = null;
  void runningApi?.close().catch((error) => {
    console.error("Failed to close AgentView API during Electron shutdown.", error);
  });
};

const boot = async () => {
  try {
    api = await startAgentViewApi({ port: 0 });
    await createMainWindow(api.baseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown startup error.";
    console.error(error);
    dialog.showErrorBox("AgentView failed to start", message);
    app.quit();
  }
};

app.whenReady().then(() => {
  void boot();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && api) {
    void createMainWindow(api.baseUrl);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", shutdownApi);
