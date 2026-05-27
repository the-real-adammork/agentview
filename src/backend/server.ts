import { createServer } from "node:http";

import type { ApiResult, HealthStatus } from "../shared/contracts";

const port = Number.parseInt(process.env.AGENTVIEW_API_PORT ?? "4317", 10);
const host = "127.0.0.1";

const healthResult: ApiResult<HealthStatus> = {
  ok: true,
  data: {
    status: "ok",
    mode: "fixture",
    checkedAt: new Date(0).toISOString(),
  },
  source: "fixture",
  warnings: [],
};

const server = createServer((request, response) => {
  if (request.url === "/api/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(healthResult));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, host, () => {
  console.log(`AgentView API listening on http://${host}:${port}`);
});
