import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { RoomFlowState, SessionManager, SyncAnchor, SyncDesyncTelemetry } from "../core/session-manager.js";
import type { PlayerInput } from "../types.js";

interface HttpRoomTransportOptions {
  sessions: SessionManager;
  authTokenSecret: string;
  authTokenTtlMs?: number;
  now?: () => number;
}

interface StartOptions {
  host?: string;
  port?: number;
}

interface AuthenticatedPlayerIdentity {
  sessionId: string;
  playerId: string;
  expiresAtMs: number;
}

interface PlayerAuthTokenPayload {
  v: 1;
  sid: string;
  pid: string;
  exp: number;
}

interface ClientSyncAnchor extends SyncAnchor {}

interface SyncMismatchResponse {
  error: "sync_mismatch";
  action: SyncDesyncTelemetry["action"];
  desync: {
    sessionId: string;
    playerId: string | null;
    reason: SyncDesyncTelemetry["reason"];
    received: ClientSyncAnchor;
    authoritative: SyncAnchor;
    tickDelta: number;
    maxAllowedTickDelta: number;
  };
  resync: {
    flowState: RoomFlowState;
  };
}

const MAX_SYNC_TICK_DELTA = 2;

export class HttpRoomTransport {
  private readonly sessions: SessionManager;

  private readonly authTokenTtlMs: number;

  private readonly now: () => number;

  private readonly authTokenService: PlayerAuthTokenService;

  private server: Server | null = null;

  private host: string | null = null;

  private port: number | null = null;

  constructor(options: HttpRoomTransportOptions) {
    this.sessions = options.sessions;
    this.authTokenTtlMs = options.authTokenTtlMs ?? 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
    this.authTokenService = new PlayerAuthTokenService(options.authTokenSecret);
  }

  async start(options: StartOptions = {}): Promise<{ host: string; port: number; url: string }> {
    if (this.server) {
      throw new Error("Transport server already started");
    }

    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 0;
    const server = createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        this.respondError(response, 500, getErrorMessage(error));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address() as AddressInfo | null;
    if (!address) {
      server.close();
      throw new Error("Transport server failed to bind");
    }

    this.server = server;
    this.host = host;
    this.port = address.port;

    return {
      host,
      port: address.port,
      url: this.baseUrl(),
    };
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const activeServer = this.server;
    this.server = null;
    this.host = null;
    this.port = null;

    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  baseUrl(): string {
    if (!this.host || this.port === null) {
      throw new Error("Transport server not started");
    }

    return `http://${this.host}:${this.port}`;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathSegments = splitPath(url.pathname);
    this.applyCorsHeaders(request, response);

    if (method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (method === "GET" && pathSegments.length === 1 && pathSegments[0] === "health") {
      this.respondJson(response, 200, { ok: true });
      return;
    }

    if (pathSegments.length < 2 || pathSegments[0] !== "v1" || pathSegments[1] !== "rooms") {
      this.respondError(response, 404, "not_found");
      return;
    }

    if (method === "POST" && pathSegments.length === 2) {
      await this.handleCreateRoom(request, response);
      return;
    }

    if (pathSegments.length < 4) {
      this.respondError(response, 404, "not_found");
      return;
    }

    const sessionId = pathSegments[2];
    const action = pathSegments[3];

    if (method === "POST" && action === "players") {
      await this.handleJoinRoom(sessionId, request, response);
      return;
    }

    if (method === "POST" && action === "input") {
      await this.handleInput(sessionId, request, response);
      return;
    }

    if (method === "POST" && action === "disconnect") {
      await this.handleDisconnect(sessionId, request, response);
      return;
    }

    if (method === "POST" && action === "leave") {
      await this.handleLeave(sessionId, request, response);
      return;
    }

    if (method === "POST" && action === "reconnect") {
      await this.handleReconnect(sessionId, request, response);
      return;
    }

    if (method === "POST" && action === "onboarding" && pathSegments.length === 5 && pathSegments[4] === "ack") {
      await this.handleOnboardingAck(sessionId, request, response);
      return;
    }

    if (method === "POST" && action === "advance") {
      await this.handleAdvance(sessionId, request, response);
      return;
    }

    if (method === "POST" && action === "complete") {
      await this.handleComplete(sessionId, request, response);
      return;
    }

    if (method === "GET" && action === "flow-state") {
      await this.handleFlowState(sessionId, response);
      return;
    }

    this.respondError(response, 404, "not_found");
  }

  private async handleCreateRoom(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const sessionId = requireString(body, "sessionId");
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();

      this.sessions.createRoom({
        sessionId,
        nowMs,
        maxPlayers: optionalNumber(body, "maxPlayers"),
        reconnectGraceMs: optionalNumber(body, "reconnectGraceMs"),
        reconnectTokenSecret: optionalString(body, "reconnectTokenSecret"),
        reconnectTokenReplayRetentionMs: optionalNumber(body, "reconnectTokenReplayRetentionMs"),
        playerInputRateLimitPerSecond: optionalNumber(body, "playerInputRateLimitPerSecond"),
        roomInputRateLimitPerSecond: optionalNumber(body, "roomInputRateLimitPerSecond"),
        inputRateWindowMs: optionalNumber(body, "inputRateWindowMs"),
      });

      this.respondJson(response, 201, {
        sessionId,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleJoinRoom(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const playerId = requireString(body, "playerId");
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();
      const spawnHeight = optionalNumber(body, "spawnHeight");
      this.sessions.joinRoom(sessionId, playerId, {
        nowMs,
        spawnHeight,
      });

      const { token, expiresAtMs } = this.authTokenService.issue(
        {
          sessionId,
          playerId,
        },
        nowMs,
        this.authTokenTtlMs,
      );

      this.respondJson(response, 201, {
        sessionId,
        playerId,
        authToken: token,
        authTokenExpiresAtMs: expiresAtMs,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleInput(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const identity = this.requireAuthenticatedIdentity(request, sessionId);
    if (!identity) {
      this.respondError(response, 401, "unauthorized");
      return;
    }

    try {
      const body = await readJsonBody(request);
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();
      const sync = requireSyncAnchor(body, "sync");
      const mismatch = this.validateSyncAnchor(sessionId, sync, "input", nowMs, identity.playerId);
      if (mismatch) {
        this.respondJson(response, 409, mismatch);
        return;
      }
      const input: PlayerInput = {
        sequence: requireNumber(body, "sequence"),
        thrust: requireNumber(body, "thrust"),
      };

      const result = this.sessions.submitInput(sessionId, identity.playerId, input, nowMs);
      this.respondJson(response, 200, {
        ...result,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleDisconnect(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const identity = this.requireAuthenticatedIdentity(request, sessionId);
    if (!identity) {
      this.respondError(response, 401, "unauthorized");
      return;
    }

    try {
      const body = await readJsonBody(request);
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();
      const sync = requireSyncAnchor(body, "sync");
      const mismatch = this.validateSyncAnchor(sessionId, sync, "disconnect", nowMs, identity.playerId);
      if (mismatch) {
        this.respondJson(response, 409, mismatch);
        return;
      }
      const result = this.sessions.disconnectPlayer(sessionId, identity.playerId, { nowMs });
      this.respondJson(response, 200, {
        ...result,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleLeave(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const identity = this.requireAuthenticatedIdentity(request, sessionId);
    if (!identity) {
      this.respondError(response, 401, "unauthorized");
      return;
    }

    try {
      const body = await readJsonBody(request);
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();
      const sync = requireSyncAnchor(body, "sync");
      const mismatch = this.validateSyncAnchor(sessionId, sync, "disconnect", nowMs, identity.playerId);
      if (mismatch) {
        this.respondJson(response, 409, mismatch);
        return;
      }
      const result = this.sessions.disconnectPlayer(sessionId, identity.playerId, { nowMs });
      this.respondJson(response, 200, {
        ...result,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleReconnect(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const identity = this.requireAuthenticatedIdentity(request, sessionId);
    if (!identity) {
      this.respondError(response, 401, "unauthorized");
      return;
    }

    try {
      const body = await readJsonBody(request);
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();
      const sync = requireSyncAnchor(body, "sync");
      const mismatch = this.validateSyncAnchor(sessionId, sync, "reconnect", nowMs, identity.playerId);
      if (mismatch) {
        this.respondJson(response, 409, mismatch);
        return;
      }
      const resumeToken = requireString(body, "resumeToken");
      const reconnect = this.sessions.reconnectPlayer(sessionId, resumeToken, {
        nowMs,
        expectedPlayerId: identity.playerId,
      });

      const status = reconnect.connected ? 200 : reconnect.reason === "unknown_token" ? 401 : 409;
      this.respondJson(response, status, {
        ...reconnect,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleOnboardingAck(
    sessionId: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const identity = this.requireAuthenticatedIdentity(request, sessionId);
    if (!identity) {
      this.respondError(response, 401, "unauthorized");
      return;
    }

    try {
      const body = await readJsonBody(request);
      const cueId = requireString(body, "cueId");
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();
      const acknowledged = this.sessions.acknowledgeOnboardingCue(sessionId, identity.playerId, cueId, nowMs);
      this.respondJson(response, 200, acknowledged);
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleAdvance(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const nowMs = optionalNumber(body, "nowMs") ?? this.now();
      const sync = requireSyncAnchor(body, "sync");
      const mismatch = this.validateSyncAnchor(sessionId, sync, "advance", nowMs, null);
      if (mismatch) {
        this.respondJson(response, 409, mismatch);
        return;
      }
      const deltaMs = requireNumber(body, "deltaMs");
      this.sessions.advanceRoom(sessionId, deltaMs, nowMs);
      this.respondJson(response, 200, {
        ok: true,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleComplete(sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const sync = requireSyncAnchor(body, "sync");
      const recordedAt = optionalNumber(body, "recordedAt") ?? this.now();
      const mismatch = this.validateSyncAnchor(sessionId, sync, "complete", recordedAt, null);
      if (mismatch) {
        this.respondJson(response, 409, mismatch);
        return;
      }
      const result = this.sessions.completeRoom(sessionId, { recordedAt });
      this.respondJson(response, 200, {
        ...result,
        sync: this.sessions.getSyncAnchor(sessionId),
      });
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private async handleFlowState(sessionId: string, response: ServerResponse): Promise<void> {
    try {
      const flowState: RoomFlowState = this.sessions.getFlowState(sessionId);
      this.respondJson(response, 200, flowState);
    } catch (error) {
      this.respondKnownError(response, error);
    }
  }

  private requireAuthenticatedIdentity(
    request: IncomingMessage,
    expectedSessionId: string,
  ): AuthenticatedPlayerIdentity | null {
    const token = extractBearerToken(request);
    if (!token) {
      return null;
    }

    const identity = this.authTokenService.verify(token, this.now());
    if (!identity || identity.sessionId !== expectedSessionId) {
      return null;
    }

    return identity;
  }

  private validateSyncAnchor(
    sessionId: string,
    received: ClientSyncAnchor,
    action: SyncDesyncTelemetry["action"],
    nowMs: number,
    playerId: string | null,
  ): SyncMismatchResponse | null {
    const authoritativeFlowState = this.sessions.getFlowState(sessionId);
    const authoritative: SyncAnchor = {
      revision: authoritativeFlowState.revision,
      tick: authoritativeFlowState.world.tick,
      stateHash: authoritativeFlowState.world.stateHash,
    };

    const tickDelta = Math.abs(authoritative.tick - received.tick);
    let reason: SyncDesyncTelemetry["reason"] | null = null;

    if (received.revision !== authoritative.revision) {
      reason = "revision_mismatch";
    } else if (received.stateHash !== authoritative.stateHash) {
      reason = "state_hash_mismatch";
    } else if (tickDelta > MAX_SYNC_TICK_DELTA) {
      reason = "tick_mismatch";
    }

    if (!reason) {
      if (playerId) {
        this.sessions.acknowledgeResyncCheckpoint(sessionId, playerId, nowMs);
      }
      return null;
    }

    this.sessions.recordSyncDesync({
      sessionId,
      playerId,
      action,
      reason,
      receivedRevision: received.revision,
      authoritativeRevision: authoritative.revision,
      receivedTick: received.tick,
      authoritativeTick: authoritative.tick,
      receivedStateHash: received.stateHash,
      authoritativeStateHash: authoritative.stateHash,
      tickDelta,
      maxAllowedTickDelta: MAX_SYNC_TICK_DELTA,
      detectedAt: nowMs,
    });

    return {
      error: "sync_mismatch",
      action,
      desync: {
        sessionId,
        playerId,
        reason,
        received,
        authoritative,
        tickDelta,
        maxAllowedTickDelta: MAX_SYNC_TICK_DELTA,
      },
      resync: {
        flowState: authoritativeFlowState,
      },
    };
  }

  private respondJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
  }

  private respondError(response: ServerResponse, statusCode: number, message: string): void {
    this.respondJson(response, statusCode, {
      error: message,
    });
  }

  private respondKnownError(response: ServerResponse, error: unknown): void {
    const message = getErrorMessage(error);
    const status = statusForError(error);
    const errorCode = machineErrorCodeForError(status, message);
    if (errorCode === message) {
      this.respondError(response, status, errorCode);
      return;
    }

    this.respondJson(response, status, {
      error: errorCode,
      message,
    });
  }

  private applyCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    response.setHeader(
      "access-control-allow-headers",
      this.resolveAllowedHeaders(request.headers["access-control-request-headers"]),
    );
    response.setHeader("access-control-max-age", "600");
  }

  private resolveAllowedHeaders(requestedHeaders: string | string[] | undefined): string {
    const allowHeaders = new Set<string>(["authorization", "content-type"]);
    for (const token of normalizeHeaderTokens(requestedHeaders)) {
      allowHeaders.add(token);
    }
    return Array.from(allowHeaders).join(",");
  }
}

class PlayerAuthTokenService {
  private readonly secret: Buffer;

  constructor(rawSecret: string) {
    this.secret = createHash("sha256").update(rawSecret).digest();
  }

  issue(
    identity: { sessionId: string; playerId: string },
    nowMs: number,
    ttlMs: number,
  ): { token: string; expiresAtMs: number } {
    const expiresAtMs = nowMs + ttlMs;
    const payload: PlayerAuthTokenPayload = {
      v: 1,
      sid: identity.sessionId,
      pid: identity.playerId,
      exp: expiresAtMs,
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = this.signPayload(encodedPayload);
    const encodedSignature = toBase64Url(signature);

    return {
      token: `${encodedPayload}.${encodedSignature}`,
      expiresAtMs,
    };
  }

  verify(token: string, nowMs: number): AuthenticatedPlayerIdentity | null {
    const [encodedPayload, encodedSignature] = token.split(".");
    if (!encodedPayload || !encodedSignature) {
      return null;
    }

    const providedSignature = fromBase64UrlToBuffer(encodedSignature);
    if (!providedSignature) {
      return null;
    }

    const expectedSignature = this.signPayload(encodedPayload);
    if (providedSignature.length !== expectedSignature.length) {
      return null;
    }
    if (!timingSafeEqual(providedSignature, expectedSignature)) {
      return null;
    }

    const parsedPayload = parseJson<PlayerAuthTokenPayload>(fromBase64UrlToString(encodedPayload));
    if (!parsedPayload) {
      return null;
    }
    if (
      parsedPayload.v !== 1 ||
      typeof parsedPayload.sid !== "string" ||
      typeof parsedPayload.pid !== "string" ||
      typeof parsedPayload.exp !== "number"
    ) {
      return null;
    }
    if (nowMs >= parsedPayload.exp) {
      return null;
    }

    return {
      sessionId: parsedPayload.sid,
      playerId: parsedPayload.pid,
      expiresAtMs: parsedPayload.exp,
    };
  }

  private signPayload(payload: string): Buffer {
    return createHmac("sha256", this.secret).update(payload).digest();
  }
}

function splitPath(pathname: string): string[] {
  return pathname
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => decodeURIComponent(part));
}

function extractBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token.trim();
}

function statusForError(error: unknown): number {
  if (!(error instanceof Error)) {
    return 500;
  }

  const message = error.message.toLowerCase();
  if (message.includes("not found")) {
    return 404;
  }
  if (message.includes("already") || message.includes("no longer in lobby") || message.includes("is full")) {
    return 409;
  }
  if (
    message.includes("must be") ||
    message.includes("required") ||
    message.includes("request body too large") ||
    message.includes("json object body required")
  ) {
    return 400;
  }

  return 500;
}

function machineErrorCodeForError(status: number, message: string): string {
  const normalized = message.toLowerCase();

  if (status === 404 && normalized.includes("not found")) {
    return "session_not_found";
  }
  if (status === 409 && normalized.includes("is full")) {
    return "room_full";
  }
  if (status === 409 && (normalized.includes("already completed") || normalized.includes("no longer in lobby"))) {
    return "room_closed";
  }
  if (status === 409 && normalized.includes("already joined")) {
    return "player_already_joined";
  }
  if (status === 400) {
    return "invalid_request";
  }
  if (status >= 500) {
    return "server_error";
  }

  return message;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "unknown_error";
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  await new Promise<void>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve());
    request.on("error", (error) => reject(error));
  });

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = parseJson<Record<string, unknown>>(raw);
  if (!parsed || Array.isArray(parsed)) {
    throw new Error("JSON object body required");
  }

  return parsed;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be non-empty string`);
  }

  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be non-empty string`);
  }

  return value;
}

function requireNumber(body: Record<string, unknown>, key: string): number {
  const value = optionalNumber(body, key);
  if (value === undefined) {
    throw new Error(`${key} must be number`);
  }

  return value;
}

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be number`);
  }

  return value;
}

function requireSyncAnchor(body: Record<string, unknown>, key: string): ClientSyncAnchor {
  const value = body[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be object`);
  }

  const sync = value as Record<string, unknown>;
  const revision = sync.revision;
  const tick = sync.tick;
  const stateHash = sync.stateHash;

  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    throw new Error(`${key}.revision must be positive integer`);
  }
  if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 0) {
    throw new Error(`${key}.tick must be non-negative integer`);
  }
  if (typeof stateHash !== "string" || stateHash.trim().length === 0) {
    throw new Error(`${key}.stateHash must be non-empty string`);
  }

  return {
    revision,
    tick,
    stateHash,
  };
}

function toBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64UrlToString(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function fromBase64UrlToBuffer(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function parseJson<TValue>(raw: string): TValue | null {
  try {
    return JSON.parse(raw) as TValue;
  } catch {
    return null;
  }
}

function normalizeHeaderTokens(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}
