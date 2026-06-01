# Self-Contained Electron App Design

## Goal

AgentView should run as a self-contained Electron desktop app. A user should be able to start the desktop app without manually running the Vite dev server or the AgentView API server in a separate terminal.

The first implementation should preserve the existing React renderer and HTTP API behavior. It should add the minimum Electron-specific lifecycle needed to package and run those pieces together.

## Architecture

Electron owns the desktop lifecycle:

- The Electron main process creates the application window.
- The main process starts the existing AgentView HTTP API in-process.
- The API binds to `127.0.0.1` on an available port chosen at runtime.
- The renderer receives the chosen API base URL through a preload bridge.
- In development, Electron can load the Vite dev server.
- In packaged mode, Electron loads the built Vite assets from disk.

The existing backend remains an HTTP API instead of moving to Electron IPC. This preserves current API boundaries, integration tests, and browser-based development while allowing Electron to manage startup and shutdown.

## Components

### Backend API Startup

`src/backend/server.ts` should be split so the API can be started programmatically and from the command line:

- A reusable API factory/start function creates the `node:http` server.
- The current `npm run api` path still starts the API on `AGENTVIEW_API_PORT` or `4317`.
- Electron can request port `0` so the operating system chooses an unused loopback port.
- Startup returns the server instance and resolved base URL.
- Shutdown closes the HTTP server when Electron exits.

### Electron Main Process

The Electron main process should:

- Start the API before loading the renderer.
- Create a `BrowserWindow` with a preload script and context isolation enabled.
- Load the Vite dev URL during `electron:dev`.
- Load `dist/index.html` in packaged mode.
- Inject the API base URL into the preload bridge before renderer code issues API requests.
- Close the API server during app shutdown.

### Electron Preload Bridge

The preload script should expose a small, read-only API surface, for example:

```ts
window.agentview.apiBaseUrl
```

The renderer should not receive direct Node access.

### Renderer API Resolution

The frontend API client and live stream client should resolve the base URL in this order:

1. Electron preload-provided runtime URL.
2. `VITE_AGENTVIEW_API_BASE_URL`.
3. Existing fallback `http://127.0.0.1:4317`.

This keeps web development and existing tests compatible.

### Build And Scripts

The project should add Electron build tooling and scripts for:

- Running Electron in development with the Vite renderer and internal API.
- Building the renderer and Electron entry files.
- Packaging the desktop app.

The initial target is a working local desktop package. Installer signing, notarization, auto-update, and distribution channels are outside this first scope.

## Data Flow

1. User launches AgentView desktop.
2. Electron main starts the AgentView API on `127.0.0.1:<available-port>`.
3. Electron creates the app window.
4. The preload bridge exposes the resolved API base URL.
5. React renderer loads and calls the existing HTTP API.
6. Live stream code uses the same runtime base URL.
7. On app quit, Electron closes the API server.

## Error Handling

- If API startup fails, Electron should show a minimal startup failure window or dialog with the error message.
- If the renderer cannot reach the API after startup, existing frontend API error UI should continue to display actionable failures.
- API server shutdown errors should not block app exit, but should be logged.
- Port conflicts should be avoided by using an operating-system-assigned port in Electron mode.

## Testing

The implementation should include focused automated coverage for:

- Programmatic API startup returns a usable local base URL.
- CLI API startup still respects `AGENTVIEW_API_PORT`.
- Renderer API base URL resolution prefers the Electron runtime URL when present.
- Renderer API base URL resolution still falls back to Vite env and default loopback URL outside Electron.

Manual verification should include:

- Run Electron in development mode.
- Confirm the dashboard loads and can fetch sessions through the internally started API.
- Build/package the desktop app and launch it locally.

## Out Of Scope

- Replacing the HTTP API with Electron IPC.
- Shipping a signed/notarized installer.
- Auto-update support.
- System tray behavior.
- Cross-platform distribution testing beyond local package creation.
