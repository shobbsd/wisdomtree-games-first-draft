import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { createBaselineRuntime, type BaselineRuntime, HttpRoomTransport } from "../index.js";
import { renderBrowserPlayableHtml } from "./browser-shell.js";

const host = process.env.PLAYABLE_HOST ?? "127.0.0.1";
const browserPort = parsePositiveInt(process.env.PLAYABLE_BROWSER_PORT, 0);
const transportPort = parsePositiveInt(process.env.PLAYABLE_TRANSPORT_PORT, 0);
const tickMs = parsePositiveInt(process.env.PLAYABLE_TICK_MS, 120);
const maxTicks = parsePositiveInt(process.env.PLAYABLE_MAX_TICKS, 220);
const roomId = process.env.PLAYABLE_ROOM_ID ?? `browser-room-${Date.now().toString(36)}`;

const runtime = createBaselineRuntime({ durableStateFilePath: null });
const transport = new HttpRoomTransport({
  sessions: runtime.sessions,
  authTokenSecret: `browser-playable:${roomId}`,
});

const transportStarted = await transport.start({
  host,
  port: transportPort,
});

const shellServer = createServer((request, response) => {
  handleShellRequest(request, response, {
    runtime,
    transportBaseUrl: transportStarted.url,
    roomId,
    tickMs,
    maxTicks,
  });
});

await new Promise<void>((resolve, reject) => {
  shellServer.once("error", reject);
  shellServer.listen(browserPort, host, () => {
    shellServer.off("error", reject);
    resolve();
  });
});

const shellAddress = shellServer.address() as AddressInfo | null;
if (!shellAddress) {
  await transport.stop();
  shellServer.close();
  throw new Error("Browser shell failed to bind");
}

const shellUrl = `http://${host}:${shellAddress.port}`;
process.stdout.write(`Browser playable shell live at ${shellUrl}\n`);
process.stdout.write(`Transport API at ${transportStarted.url}\n`);
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
  await transport.stop();
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

interface ShellRequestContext {
  runtime: BaselineRuntime;
  transportBaseUrl: string;
  roomId: string;
  tickMs: number;
  maxTicks: number;
}

type EliminationActionId = Parameters<BaselineRuntime["sessions"]["selectEliminationAction"]>[1];
type PostMatchActionId = Parameters<BaselineRuntime["sessions"]["selectPostMatchAction"]>[1];

function handleShellRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ShellRequestContext,
): void {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = splitPath(url.pathname);

  if (method === "GET" && url.pathname === "/health") {
    respondJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/global-leaderboard") {
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
    void handleEliminationAction(request, response, context, path[2]);
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
    void handlePostMatchAction(request, response, context, path[2]);
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
    void handleResultsAck(request, response, context, path[2]);
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
    const selected = context.runtime.sessions.selectEliminationAction(sessionId, actionId, nowMs);
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
    const selected = context.runtime.sessions.selectPostMatchAction(sessionId, actionId, nowMs);
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
    const lifecycle = context.runtime.sessions.acknowledgeResultsFailure(sessionId, nowMs);
    respondJson(response, 200, lifecycle);
  } catch (error) {
    respondKnownError(response, error);
  }
}

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody.length) {
    return {};
  }

  const parsed = JSON.parse(rawBody) as unknown;
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
