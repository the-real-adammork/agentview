import { createServer } from "node:http";

import { handleFixtureApiRequest } from "./api/fixtures";

const port = Number.parseInt(process.env.AGENTVIEW_API_PORT ?? "4317", 10);
const host = "127.0.0.1";

const server = createServer((request, response) => {
  if (handleFixtureApiRequest(request, response)) {
    return;
  }
});

server.listen(port, host, () => {
  console.log(`AgentView API listening on http://${host}:${port}`);
});
