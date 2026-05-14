import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { createBaselineRuntime, type BaselineRuntime, HttpRoomTransport } from "../index.js";
import { renderBrowserPlayableHtml } from "./browser-shell.js";
import { resolveBrowserPlayableRuntimeConfig } from "./browser-playable-runtime.js";

interface ShellRequestContext {
  runtime: BaselineRuntime | null;
  transportBaseUrl: string;
  transportProxyTargetBaseUrl: string | null;
  roomId: string;
  tickMs: number;
  maxTicks: number;
}

interface TransportHandle {
  publicBaseUrl: string;
  proxyTargetBaseUrl: string | null;
  stop(): Promise<void>;
}

type EliminationActionId = NonNullable<BaselineRuntime>["sessions"] extends {
  selectEliminationAction: (sessionId: string, actionId: infer TAction, nowMs?: number) => unknown;
}
  ? TAction
  : never;
type PostMatchActionId = NonNullable<BaselineRuntime>["sessions"] extends {
  selectPostMatchAction: (sessionId: string, actionId: infer TAction, nowMs?: number) => unknown;
}
  ? TAction
  : never;

const runtimeConfig = resolveBrowserPlayableRuntimeConfig(process.env);
const runtime = runtimeConfig.shouldStartInternalTransport ? createBaselineRuntime({ durableStateFilePath: null }) : null;
const transportHandle = runtime
  ? await startInternalTransport(runtime, runtimeConfig.roomId, runtimeConfig.host, runtimeConfig.transportPort)
  : createExternalTransportHandle(runtimeConfig.transportProxyTargetBaseUrl);

const shellServer = createServer((request, response) => {
  void handleShellRequest(request, response, {
    runtime,
    transportBaseUrl: runtime ? transportHandle.publicBaseUrl : runtimeConfig.clientTransportBaseUrl,
    transportProxyTargetBaseUrl: transportHandle.proxyTargetBaseUrl,
    roomId: runtimeConfig.roomId,
    tickMs: runtimeConfig.tickMs,
    maxTicks: runtimeConfig.maxTicks,
  });
});

await new Promise<void>((resolve, reject) => {
  shellServer.once("error", reject);
  shellServer.listen(runtimeConfig.browserPort, runtimeConfig.host, () => {
    shellServer.off("error", reject);
    resolve();
  });
});

const shellAddress = shellServer.address() as AddressInfo | null;
if (!shellAddress) {
  await transportHandle.stop();
  shellServer.close();
  throw new Error("Browser shell failed to bind");
}

const shellUrl = `http://${runtimeConfig.host}:${shellAddress.port}`;
process.stdout.write(`Browser playable shell live at ${shellUrl}\n`);
if (transportHandle.proxyTargetBaseUrl) {
  process.stdout.write(`Transport API proxied to ${transportHandle.proxyTargetBaseUrl}\n`);
} else {
  process.stdout.write(`Transport API at ${transportHandle.publicBaseUrl}\n`);
}
process.stdout.write("Desktop controls: W/Space/ArrowUp jump, S/ArrowDown drop, A/D or arrows run left/right.\n");
process.stdout.write("Mobile controls: on-screen up/down/left/right pad rendered in mobile/auto surface mode.\n");

let shutdownInFlight = false;
const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
  if (shutdownInFlight) {
    return;
  }

  shutdownInFlight = true;
  await new Promise<void>((resolve, reject) => {
    shellServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await transportHandle.stop();
  process.stdout.write(`Browser playable shell stopped (${signal})\n`);
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await new Promise<void>(() => {
  // keep process alive until signal handlers close shell + transport
});

async function startInternalTransport(
  playableRuntime: BaselineRuntime,
  roomId: string,
  host: string,
  transportPort: number,
): Promise<TransportHandle> {
  const transport = new HttpRoomTransport({
    sessions: playableRuntime.sessions,
    authTokenSecret: `browser-playable:${roomId}`,
  });

  const started = await transport.start({
    host,
    port: transportPort,
  });

  return {
    publicBaseUrl: started.url,
    proxyTargetBaseUrl: null,
    async stop() {
      await transport.stop();
    },
  };
}

function createExternalTransportHandle(proxyTargetBaseUrl: string | null): TransportHandle {
  if (!proxyTargetBaseUrl) {
    throw new Error("External transport proxy target must be configured when internal transport is disabled");
  }

  return {
    publicBaseUrl: "/transport",
    proxyTargetBaseUrl,
    async stop() {
      // no-op for externally managed API service
    },
  };
}

async function handleShellRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ShellRequestContext,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = splitPath(url.pathname);

  if (method === "GET" && url.pathname === "/health") {
    respondJson(response, 200, { ok: true });
    return;
  }

  if (context.transportProxyTargetBaseUrl) {
    const transportProxyUrl = resolveTransportProxyUrl(url, context.transportProxyTargetBaseUrl);
    if (transportProxyUrl) {
      await proxyRequest(request, response, transportProxyUrl);
      return;
    }

    const shellProxyUrl = resolveShellApiProxyUrl(url, context.transportProxyTargetBaseUrl);
    if (shellProxyUrl) {
      await proxyRequest(request, response, shellProxyUrl);
      return;
    }
  }

  if (method === "GET" && url.pathname === "/api/global-leaderboard") {
    if (!context.runtime) {
      respondJson(response, 503, { error: "transport_proxy_unavailable" });
      return;
    }

    const limit = clampLimit(parsePositiveInt(url.searchParams.get("limit"), 10));
    respondJson(response, 200, {
      standings: context.runtime.leaderboard.getStandings(limit),
    });
    return;
  }

  if (
    method === "POST" &&
    path.length === 5 &&
    path[0] === "api" &&
    path[1] === "rooms" &&
    path[3] === "elimination" &&
    path[4] === "action"
  ) {
    if (!context.runtime) {
      respondJson(response, 503, { error: "transport_proxy_unavailable" });
      return;
    }
    await handleEliminationAction(request, response, context, path[2]);
    return;
  }

  if (
    method === "POST" &&
    path.length === 5 &&
    path[0] === "api" &&
    path[1] === "rooms" &&
    path[3] === "post-match" &&
    path[4] === "action"
  ) {
    if (!context.runtime) {
      respondJson(response, 503, { error: "transport_proxy_unavailable" });
      return;
    }
    await handlePostMatchAction(request, response, context, path[2]);
    return;
  }

  if (
    method === "POST" &&
    path.length === 5 &&
    path[0] === "api" &&
    path[1] === "rooms" &&
    path[3] === "results" &&
    path[4] === "ack"
  ) {
    if (!context.runtime) {
      respondJson(response, 503, { error: "transport_proxy_unavailable" });
      return;
    }
    await handleResultsAck(request, response, context, path[2]);
    return;
  }

  if (method === "GET" && url.pathname === "/") {
    const html = renderBrowserPlayableHtml({
      title: "WIS-483 Browser Playable Shell",
      roomId: context.roomId,
      transportBaseUrl: context.transportBaseUrl,
      tickMs: context.tickMs,
      maxTicks: context.maxTicks,
    });

    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(html);
    return;
  }

  respondJson(response, 404, { error: "not_found" });
}

function resolveTransportProxyUrl(url: URL, proxyTargetBaseUrl: string): string | null {
  if (!url.pathname.startsWith("/transport")) {
    return null;
  }

  const suffix = url.pathname === "/transport" ? "" : url.pathname.slice("/transport".length);
  return `${proxyTargetBaseUrl}${suffix}${url.search}`;
}

function resolveShellApiProxyUrl(url: URL, proxyTargetBaseUrl: string): string | null {
  if (url.pathname === "/api/global-leaderboard") {
    return `${proxyTargetBaseUrl}/v1/leaderboard${url.search}`;
  }

  const path = splitPath(url.pathname);
  if (path.length === 5 && path[0] === "api" && path[1] === "rooms" && path[3] === "elimination" && path[4] === "action") {
    return `${proxyTargetBaseUrl}/v1/rooms/${path[2]}/elimination/action${url.search}`;
  }

  if (path.length === 5 && path[0] === "api" && path[1] === "rooms" && path[3] === "post-match" && path[4] === "action") {
    return `${proxyTargetBaseUrl}/v1/rooms/${path[2]}/post-match/action${url.search}`;
  }

  if (path.length === 5 && path[0] === "api" && path[1] === "rooms" && path[3] === "results" && path[4] === "ack") {
    return `${proxyTargetBaseUrl}/v1/rooms/${path[2]}/results/ack${url.search}`;
  }

  return null;
}

async function proxyRequest(request: IncomingMessage, response: ServerResponse, targetUrl: string): Promise<void> {
  try {
    const body = mayHaveBody(request.method) ? await readRawBody(request) : undefined;
    const headers = new Headers();
    copyHeader(request.headers.authorization, "authorization", headers);
    copyHeader(request.headers["content-type"], "content-type", headers);

    const upstream = await fetch(targetUrl, {
      method: request.method ?? "GET",
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });

    response.statusCode = upstream.status;
    copyResponseHeader(upstream, response, "content-type");
    copyResponseHeader(upstream, response, "cache-control");
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    respondKnownError(response, error);
  }
}

function copyHeader(value: string | string[] | undefined, name: string, headers: Headers): void {
  if (typeof value === "string" && value.length > 0) {
    headers.set(name, value);
  }
}

function copyResponseHeader(upstream: Response, response: ServerResponse, name: string): void {
  const value = upstream.headers.get(name);
  if (value) {
    response.setHeader(name, value);
  }
}

function mayHaveBody(method: string | undefined): boolean {
  return method !== "GET" && method !== "HEAD";
}

async function readRawBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

function respondJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 50));
}

async function handleEliminationAction(
  request: IncomingMessage,
  response: ServerResponse,
  context: ShellRequestContext,
  sessionId: string,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const actionId = requireEliminationActionId(body, "actionId");
    const nowMs = optionalNumber(body, "nowMs") ?? Date.now();
    const selected = context.runtime!.sessions.selectEliminationAction(sessionId, actionId, nowMs);
    respondJson(response, 200, selected);
  } catch (error) {
    respondKnownError(response, error);
  }
}

async function handlePostMatchAction(
  request: IncomingMessage,
  response: ServerResponse,
  context: ShellRequestContext,
  sessionId: string,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const actionId = requirePostMatchActionId(body, "actionId");
    const nowMs = optionalNumber(body, "nowMs") ?? Date.now();
    const selected = context.runtime!.sessions.selectPostMatchAction(sessionId, actionId, nowMs);
    respondJson(response, 200, selected);
  } catch (error) {
    respondKnownError(response, error);
  }
}

async function handleResultsAck(
  request: IncomingMessage,
  response: ServerResponse,
  context: ShellRequestContext,
  sessionId: string,
): Promise<void> {
  try {
    const body = await readJsonBody(request);
    const nowMs = optionalNumber(body, "nowMs") ?? Date.now();
    const lifecycle = context.runtime!.sessions.acknowledgeResultsFailure(sessionId, nowMs);
    respondJson(response, 200, lifecycle);
  } catch (error) {
    respondKnownError(response, error);
  }
}

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const rawBody = await readRawBody(request);
  if (!rawBody || rawBody.length === 0) {
    return {};
  }

  const parsed = JSON.parse(rawBody.toString("utf8").trim()) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be an object");
  }

  return parsed as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing string field ${field}`);
  }
  return value;
}

function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected numeric field ${field}`);
  }
  return value;
}

function requireEliminationActionId(body: Record<string, unknown>, field: string): EliminationActionId {
  const value = requireString(body, field);
  if (value === "VIEW_RESULTS" || value === "VIEW_LEADERBOARD" || value === "SPECTATE") {
    return value;
  }
  throw new Error(`Unknown elimination action ${value}`);
}

function requirePostMatchActionId(body: Record<string, unknown>, field: string): PostMatchActionId {
  const value = requireString(body, field);
  if (value === "REPLAY_MATCH" || value === "BACK_TO_LOBBY" || value === "EXIT_TO_MENU") {
    return value;
  }
  throw new Error(`Unknown post-match action ${value}`);
}

function respondKnownError(response: ServerResponse, error: unknown): void {
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();
  const statusCode =
    normalized.includes("unknown") || normalized.includes("missing") || normalized.includes("invalid")
      ? 400
      : normalized.includes("not in") || normalized.includes("already")
        ? 409
        : 500;
  respondJson(response, statusCode, {
    error: statusCode === 500 ? "internal_error" : "invalid_request",
    message,
  });
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}
