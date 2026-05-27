import React from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/big-shoulders-display/latin-500.css";
import "@fontsource/big-shoulders-display/latin-600.css";
import "@fontsource/big-shoulders-display/latin-700.css";
import "@fontsource/big-shoulders-display/latin-800.css";
import "@fontsource/big-shoulders-display/latin-900.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/shippori-mincho/japanese-500.css";
import "@fontsource/shippori-mincho/japanese-700.css";

import { App } from "./App";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
