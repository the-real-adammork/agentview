import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";

import { startAgentViewApiProcess, type RunningAgentViewApiProcess } from "./apiProcess";

let mainWindow: BrowserWindow | null = null;
let api: RunningAgentViewApiProcess | null = null;

const isDevelopment = () => process.env.AGENTVIEW_ELECTRON_DEV === "1" || !app.isPackaged;

const rendererDevUrl = () => process.env.AGENTVIEW_RENDERER_URL ?? "http://127.0.0.1:5173";

const createMainWindow = async (apiBaseUrl: string) => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: "AgentView",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 13 },
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
  runningApi?.close();
};

const boot = async () => {
  try {
    api = await startAgentViewApiProcess();
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
