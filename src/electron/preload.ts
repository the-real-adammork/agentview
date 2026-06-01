import { contextBridge } from "electron";

const API_BASE_URL_ARG = "--agentview-api-base-url=";

const readApiBaseUrl = () => {
  const arg = process.argv.find((value) => value.startsWith(API_BASE_URL_ARG));
  if (!arg) {
    return undefined;
  }

  return decodeURIComponent(arg.slice(API_BASE_URL_ARG.length));
};

contextBridge.exposeInMainWorld(
  "agentview",
  Object.freeze({
    apiBaseUrl: readApiBaseUrl(),
  }),
);
