import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { URL } from "node:url";
import { getPolicyDetailView, getPolicyFullView, listPolicies, listPolicyInsureds } from "../underwriting/service.ts";

export interface ApiResponse {
  status: number;
  payload: unknown;
}

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3001");
const publicDir = join(process.cwd(), "public");

function json(status: number, payload: unknown): ApiResponse {
  return { status, payload };
}

export function handleGetRequest(url: string): ApiResponse {
  const requestUrl = new URL(url, `http://${host}:${port}`);
  const pathname = requestUrl.pathname;

  if (pathname === "/api/health") {
    return json(200, {
      status: "ok",
      service: "underwriting-query-api",
      date: new Date().toISOString(),
    });
  }

  if (pathname === "/api/policies") {
    const result = listPolicies({
      policyNo: requestUrl.searchParams.get("policyNo") ?? undefined,
      applicantName: requestUrl.searchParams.get("applicantName") ?? undefined,
      insuredName: requestUrl.searchParams.get("insuredName") ?? undefined,
      insuredIdNo: requestUrl.searchParams.get("insuredIdNo") ?? undefined,
      policyStatus: (requestUrl.searchParams.get("policyStatus") as
        | "enabled"
        | "disabled"
        | null) ?? undefined,
      page: Number(requestUrl.searchParams.get("page") ?? 1),
      pageSize: Number(requestUrl.searchParams.get("pageSize") ?? 10),
    });

    return json(200, result);
  }

  const policyIdMatch = pathname.match(/^\/api\/policies\/([^/]+)$/);
  if (policyIdMatch) {
    const fullView = getPolicyFullView(policyIdMatch[1]);
    return fullView ? json(200, fullView.policy) : json(404, { message: "Not Found" });
  }

  const policyProductsMatch = pathname.match(/^\/api\/policies\/([^/]+)\/products$/);
  if (policyProductsMatch) {
    const fullView = getPolicyFullView(policyProductsMatch[1]);
    return fullView
      ? json(200, {
          policyId: fullView.policy.id,
          policyNo: fullView.policy.policyNo,
          items: fullView.products,
          total: fullView.products.length,
        })
      : json(404, { message: "Not Found" });
  }

  const policyInsuredsMatch = pathname.match(/^\/api\/policies\/([^/]+)\/insureds$/);
  if (policyInsuredsMatch) {
    const result = listPolicyInsureds(policyInsuredsMatch[1], {
      page: Number(requestUrl.searchParams.get("page") ?? 1),
      pageSize: Number(requestUrl.searchParams.get("pageSize") ?? 10),
    });
    return result ? json(200, result) : json(404, { message: "Not Found" });
  }

  const policyFullViewMatch = pathname.match(/^\/api\/policies\/([^/]+)\/full-view$/);
  if (policyFullViewMatch) {
    const detailView = getPolicyDetailView(policyFullViewMatch[1]);
    return detailView ? json(200, detailView) : json(404, { message: "Not Found" });
  }

  return json(404, { message: "Not Found" });
}

function sendJson(res: ServerResponse, response: ApiResponse) {
  const body = JSON.stringify(response.payload, null, 2);
  res.writeHead(response.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

function sendFile(res: ServerResponse, filePath: string) {
  const file = readFileSync(filePath);
  const extension = extname(filePath);
  const contentType =
    extension === ".html"
      ? "text/html; charset=utf-8"
      : extension === ".css"
        ? "text/css; charset=utf-8"
        : "application/javascript; charset=utf-8";

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": file.byteLength.toString(),
  });
  res.end(file);
}

function requestHandler(req: IncomingMessage, res: ServerResponse) {
  if (!req.url || !req.method) {
    sendJson(res, json(400, { message: "Bad Request" }));
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, json(405, { message: "Method Not Allowed" }));
    return;
  }

  if (req.url === "/" || req.url.startsWith("/index.html")) {
    sendFile(res, join(publicDir, "index.html"));
    return;
  }

  if (req.url.startsWith("/app.js")) {
    sendFile(res, join(publicDir, "app.js"));
    return;
  }

  if (req.url.startsWith("/styles.css")) {
    sendFile(res, join(publicDir, "styles.css"));
    return;
  }

  sendJson(res, handleGetRequest(req.url));
}

export function createApiServer() {
  return createServer(requestHandler);
}

export function startApiServer() {
  const server = createApiServer();
  server.listen(port, host, () => {
    console.log(`Underwriting query API running at http://${host}:${port}`);
  });
  return server;
}

if (process.argv[1]?.endsWith("src/api/server.ts")) {
  startApiServer();
}
