import { afterEach, describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";
import { HttpRoomTransport } from "../src/transport/http-room-transport";

interface JsonResponse<TBody = unknown> {
  status: number;
  body: TBody;
}

interface SyncAnchor {
  revision: number;
  tick: number;
  stateHash: string;
}

interface MinimalFlowState {
  revision: number;
  world: {
    tick: number;
    stateHash: string;
  };
}

interface SyncMismatchResponse {
  error: "sync_mismatch";
  action: string;
  desync: {
    sessionId: string;
    playerId: string | null;
    reason: "revision_mismatch" | "state_hash_mismatch" | "tick_mismatch";
    received: SyncAnchor;
    authoritative: SyncAnchor;
    tickDelta: number;
    maxAllowedTickDelta: number;
  };
  resync: {
    flowState: MinimalFlowState;
  };
}

describe("HttpRoomTransport", () => {
  let transport: HttpRoomTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.stop();
      transport = null;
    }
  });

  it("serves authoritative room lifecycle and preserves telemetry through HTTP surface", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();

    const createRoom = await requestJson<{ sessionId: string }>(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-1",
        nowMs: 0,
      },
    });
    expect(createRoom.status).toBe(201);
    expect(createRoom.body.sessionId).toBe("room-http-1");

    const alphaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-1/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        spawnHeight: 6,
        nowMs: 0,
      },
    });
    const betaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-1/players`, {
      method: "POST",
      body: {
        playerId: "beta",
        spawnHeight: 1.4,
        nowMs: 0,
      },
    });
    expect(alphaJoin.status).toBe(201);
    expect(betaJoin.status).toBe(201);

    const unauthorizedInput = await requestJson<{ error: string }>(`${baseUrl}/v1/rooms/room-http-1/input`, {
      method: "POST",
      body: { sequence: 1, thrust: 0.1, nowMs: 10 },
    });
    expect(unauthorizedInput.status).toBe(401);
    expect(unauthorizedInput.body.error).toBe("unauthorized");

    const activeSync = await getSyncAnchor(baseUrl, "room-http-1");

    const alphaInput = await requestJson<{ accepted: boolean }>(`${baseUrl}/v1/rooms/room-http-1/input`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: { sequence: 1, thrust: 0.2, nowMs: 10, sync: activeSync },
    });
    const betaInput = await requestJson<{ accepted: boolean }>(`${baseUrl}/v1/rooms/room-http-1/input`, {
      method: "POST",
      authToken: betaJoin.body.authToken,
      body: { sequence: 1, thrust: 0, nowMs: 20, sync: activeSync },
    });
    expect(alphaInput.status).toBe(200);
    expect(betaInput.status).toBe(200);
    expect(alphaInput.body.accepted).toBe(true);
    expect(betaInput.body.accepted).toBe(true);

    const advance = await requestJson<{ ok: true }>(`${baseUrl}/v1/rooms/room-http-1/advance`, {
      method: "POST",
      body: { deltaMs: 1000, nowMs: 1_000, sync: activeSync },
    });
    expect(advance.status).toBe(200);

    const complete = await requestJson<{ commits: Array<{ playerId: string }> }>(
      `${baseUrl}/v1/rooms/room-http-1/complete`,
      {
        method: "POST",
        body: { recordedAt: 1_001, sync: await getSyncAnchor(baseUrl, "room-http-1") },
      },
    );
    expect(complete.status).toBe(200);
    expect(complete.body.commits).toHaveLength(2);

    expect(eventSink.list({ type: "session.lifecycle.created" })).toHaveLength(1);
    expect(eventSink.list({ type: "session.slo.tick_lag" })).toHaveLength(1);
    expect(eventSink.list({ type: "session.lifecycle.completed" })).toHaveLength(1);
  });

  it("requires reconnect identity to match authenticated player", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-2",
        nowMs: 0,
      },
    });
    const alphaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-2/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 0,
      },
    });
    const betaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-2/players`, {
      method: "POST",
      body: {
        playerId: "beta",
        nowMs: 0,
      },
    });

    const activeSync = await getSyncAnchor(baseUrl, "room-http-2");

    const disconnect = await requestJson<{ resumeToken: string }>(`${baseUrl}/v1/rooms/room-http-2/disconnect`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: { nowMs: 100, sync: activeSync },
    });
    expect(disconnect.status).toBe(200);

    const forbiddenReconnect = await requestJson<{ connected: boolean; reason: string }>(
      `${baseUrl}/v1/rooms/room-http-2/reconnect`,
      {
        method: "POST",
        authToken: betaJoin.body.authToken,
        body: {
          resumeToken: disconnect.body.resumeToken,
          nowMs: 200,
          sync: await getSyncAnchor(baseUrl, "room-http-2"),
        },
      },
    );
    expect(forbiddenReconnect.status).toBe(401);
    expect(forbiddenReconnect.body.connected).toBe(false);
    expect(forbiddenReconnect.body.reason).toBe("unknown_token");

    const flowStateAfterForbidden = await requestJson<{ players: Array<{ playerId: string; connected: boolean }> }>(
      `${baseUrl}/v1/rooms/room-http-2/flow-state`,
      {
        method: "GET",
      },
    );
    const alphaAfterForbidden = flowStateAfterForbidden.body.players.find((player) => player.playerId === "alpha");
    expect(alphaAfterForbidden?.connected).toBe(false);

    const reconnect = await requestJson<{ connected: boolean; playerId: string }>(
      `${baseUrl}/v1/rooms/room-http-2/reconnect`,
      {
        method: "POST",
        authToken: alphaJoin.body.authToken,
        body: {
          resumeToken: disconnect.body.resumeToken,
          nowMs: 220,
          sync: await getSyncAnchor(baseUrl, "room-http-2"),
        },
      },
    );
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.connected).toBe(true);
    expect(reconnect.body.playerId).toBe("alpha");
  });

  it("supports leave alias for create/join/leave/reconnect lifecycle", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-leave",
        nowMs: 0,
      },
    });
    const alphaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-leave/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 0,
      },
    });

    const leave = await requestJson<{ resumeToken: string }>(`${baseUrl}/v1/rooms/room-http-leave/leave`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: {
        nowMs: 100,
        sync: await getSyncAnchor(baseUrl, "room-http-leave"),
      },
    });
    expect(leave.status).toBe(200);
    expect(typeof leave.body.resumeToken).toBe("string");

    const flowStateAfterLeave = await requestJson<{ players: Array<{ playerId: string; connected: boolean }> }>(
      `${baseUrl}/v1/rooms/room-http-leave/flow-state`,
      {
        method: "GET",
      },
    );
    expect(flowStateAfterLeave.status).toBe(200);
    expect(flowStateAfterLeave.body.players.find((player) => player.playerId === "alpha")?.connected).toBe(false);

    const reconnect = await requestJson<{ connected: boolean; playerId: string }>(
      `${baseUrl}/v1/rooms/room-http-leave/reconnect`,
      {
        method: "POST",
        authToken: alphaJoin.body.authToken,
        body: {
          resumeToken: leave.body.resumeToken,
          nowMs: 110,
          sync: await getSyncAnchor(baseUrl, "room-http-leave"),
        },
      },
    );
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.connected).toBe(true);
    expect(reconnect.body.playerId).toBe("alpha");

    expect(eventSink.list({ type: "session.lifecycle.player_disconnected" })).toHaveLength(1);
  });

  it("returns machine-readable reasons for full, closed, and nonexistent rooms", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-full",
        nowMs: 0,
        maxPlayers: 1,
      },
    });
    await requestJson(`${baseUrl}/v1/rooms/room-http-full/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 0,
      },
    });
    const roomFull = await requestJson<{ error: string; message?: string }>(`${baseUrl}/v1/rooms/room-http-full/players`, {
      method: "POST",
      body: {
        playerId: "beta",
        nowMs: 1,
      },
    });
    expect(roomFull.status).toBe(409);
    expect(roomFull.body.error).toBe("room_full");

    const sessionMissing = await requestJson<{ error: string; message?: string }>(`${baseUrl}/v1/rooms/room-http-missing/players`, {
      method: "POST",
      body: {
        playerId: "ghost",
        nowMs: 1,
      },
    });
    expect(sessionMissing.status).toBe(404);
    expect(sessionMissing.body.error).toBe("session_not_found");

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-closed",
        nowMs: 0,
      },
    });
    await requestJson(`${baseUrl}/v1/rooms/room-http-closed/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 0,
      },
    });
    await requestJson(`${baseUrl}/v1/rooms/room-http-closed/complete`, {
      method: "POST",
      body: {
        recordedAt: 2,
        sync: await getSyncAnchor(baseUrl, "room-http-closed"),
      },
    });
    const roomClosed = await requestJson<{ error: string; message?: string }>(
      `${baseUrl}/v1/rooms/room-http-closed/players`,
      {
        method: "POST",
        body: {
          playerId: "late-joiner",
          nowMs: 3,
        },
      },
    );
    expect(roomClosed.status).toBe(409);
    expect(roomClosed.body.error).toBe("room_closed");
  });

  it("acknowledges first-session onboarding cue through authenticated transport path", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-onboarding",
        nowMs: 0,
      },
    });
    const alphaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-onboarding/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 0,
      },
    });

    sessions.markTransportConnectFailed("room-http-onboarding", 10);

    const beforeAck = await requestJson<{ uxState?: { onboarding?: { byPlayerId?: Record<string, unknown> } } }>(
      `${baseUrl}/v1/rooms/room-http-onboarding/flow-state`,
      {
        method: "GET",
      },
    );
    expect(beforeAck.status).toBe(200);
    expect(beforeAck.body.uxState?.onboarding?.byPlayerId?.alpha).toMatchObject({
      id: "OB-QUEUE-FALLBACK",
    });

    const ack = await requestJson<{ acknowledged: boolean; alreadyAcknowledged: boolean; cueId: string; playerId: string }>(
      `${baseUrl}/v1/rooms/room-http-onboarding/onboarding/ack`,
      {
        method: "POST",
        authToken: alphaJoin.body.authToken,
        body: {
          cueId: "OB-QUEUE-FALLBACK",
          nowMs: 20,
        },
      },
    );
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({
      acknowledged: true,
      alreadyAcknowledged: false,
      cueId: "OB-QUEUE-FALLBACK",
      playerId: "alpha",
    });

    const afterAck = await requestJson<{ uxState?: { onboarding?: { byPlayerId?: Record<string, unknown> } } }>(
      `${baseUrl}/v1/rooms/room-http-onboarding/flow-state`,
      {
        method: "GET",
      },
    );
    expect(afterAck.status).toBe(200);
    expect(afterAck.body.uxState?.onboarding?.byPlayerId?.alpha).toBeNull();
  });

  it("gates stale sync anchors with reconciliation payload and emits desync telemetry", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-sync-gate",
        nowMs: 0,
      },
    });
    const alphaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-sync-gate/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 0,
      },
    });
    const staleSync = await getSyncAnchor(baseUrl, "room-http-sync-gate");

    const advance = await requestJson(`${baseUrl}/v1/rooms/room-http-sync-gate/advance`, {
      method: "POST",
      body: {
        deltaMs: 100,
        nowMs: 100,
        sync: staleSync,
      },
    });
    expect(advance.status).toBe(200);

    const staleInput = await requestJson<SyncMismatchResponse>(`${baseUrl}/v1/rooms/room-http-sync-gate/input`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: {
        sequence: 1,
        thrust: 0.3,
        nowMs: 110,
        sync: staleSync,
      },
    });

    expect(staleInput.status).toBe(409);
    expect(staleInput.body.error).toBe("sync_mismatch");
    expect(staleInput.body.action).toBe("input");
    expect(staleInput.body.desync.reason).toBe("revision_mismatch");
    expect(staleInput.body.desync.sessionId).toBe("room-http-sync-gate");
    expect(staleInput.body.desync.playerId).toBe("alpha");
    expect(staleInput.body.desync.received).toEqual(staleSync);
    expect(staleInput.body.desync.tickDelta).toBeLessThanOrEqual(staleInput.body.desync.maxAllowedTickDelta);
    expect(staleInput.body.resync.flowState.revision).toBe(staleInput.body.desync.authoritative.revision);
    expect(staleInput.body.resync.flowState.world.stateHash).toBe(staleInput.body.desync.authoritative.stateHash);

    const reconciledSync = flowStateToSync(staleInput.body.resync.flowState);
    const retriedInput = await requestJson<{ accepted: boolean }>(`${baseUrl}/v1/rooms/room-http-sync-gate/input`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: {
        sequence: 1,
        thrust: 0.3,
        nowMs: 120,
        sync: reconciledSync,
      },
    });
    expect(retriedInput.status).toBe(200);
    expect(retriedInput.body.accepted).toBe(true);

    const desyncEvents = eventSink.list({ type: "session.sync.desync_detected" });
    expect(desyncEvents).toHaveLength(1);
    expect(desyncEvents[0]?.payload).toMatchObject({
      sessionId: "room-http-sync-gate",
      playerId: "alpha",
      action: "input",
      reason: "revision_mismatch",
      receivedRevision: staleSync.revision,
      authoritativeRevision: staleInput.body.desync.authoritative.revision,
    });
  });

  it("reconciles delayed/duplicate packets and reconnect path without score corruption", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-sync-reconnect",
        nowMs: 0,
      },
    });
    const alphaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-sync-reconnect/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 0,
        spawnHeight: 6,
      },
    });
    const betaJoin = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-http-sync-reconnect/players`, {
      method: "POST",
      body: {
        playerId: "beta",
        nowMs: 0,
        spawnHeight: 6,
      },
    });

    const syncBeforeTick = await getSyncAnchor(baseUrl, "room-http-sync-reconnect");
    const seedInput = await requestJson<{ accepted: boolean }>(`${baseUrl}/v1/rooms/room-http-sync-reconnect/input`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: {
        sequence: 1,
        thrust: 0.5,
        nowMs: 10,
        sync: syncBeforeTick,
      },
    });
    expect(seedInput.status).toBe(200);
    expect(seedInput.body.accepted).toBe(true);

    const firstAdvance = await requestJson(`${baseUrl}/v1/rooms/room-http-sync-reconnect/advance`, {
      method: "POST",
      body: {
        deltaMs: 100,
        nowMs: 100,
        sync: syncBeforeTick,
      },
    });
    expect(firstAdvance.status).toBe(200);

    const syncAfterFirstTick = await getSyncAnchor(baseUrl, "room-http-sync-reconnect");
    const disconnect = await requestJson<{ resumeToken: string }>(`${baseUrl}/v1/rooms/room-http-sync-reconnect/disconnect`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: {
        nowMs: 120,
        sync: syncAfterFirstTick,
      },
    });
    expect(disconnect.status).toBe(200);

    const syncAfterDisconnect = await getSyncAnchor(baseUrl, "room-http-sync-reconnect");
    const secondAdvance = await requestJson(`${baseUrl}/v1/rooms/room-http-sync-reconnect/advance`, {
      method: "POST",
      body: {
        deltaMs: 100,
        nowMs: 200,
        sync: syncAfterDisconnect,
      },
    });
    expect(secondAdvance.status).toBe(200);

    const staleReconnect = await requestJson<SyncMismatchResponse>(
      `${baseUrl}/v1/rooms/room-http-sync-reconnect/reconnect`,
      {
        method: "POST",
        authToken: alphaJoin.body.authToken,
        body: {
          resumeToken: disconnect.body.resumeToken,
          nowMs: 220,
          sync: syncAfterFirstTick,
        },
      },
    );
    expect(staleReconnect.status).toBe(409);
    expect(staleReconnect.body.error).toBe("sync_mismatch");
    expect(staleReconnect.body.action).toBe("reconnect");
    expect(staleReconnect.body.desync.tickDelta).toBeLessThanOrEqual(staleReconnect.body.desync.maxAllowedTickDelta);

    const reconnectSync = flowStateToSync(staleReconnect.body.resync.flowState);
    const reconnect = await requestJson<{ connected: boolean; playerId: string }>(
      `${baseUrl}/v1/rooms/room-http-sync-reconnect/reconnect`,
      {
        method: "POST",
        authToken: alphaJoin.body.authToken,
        body: {
          resumeToken: disconnect.body.resumeToken,
          nowMs: 230,
          sync: reconnectSync,
        },
      },
    );
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.connected).toBe(true);
    expect(reconnect.body.playerId).toBe("alpha");

    const delayedDuplicate = await requestJson<SyncMismatchResponse>(`${baseUrl}/v1/rooms/room-http-sync-reconnect/input`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: {
        sequence: 2,
        thrust: 0.6,
        nowMs: 240,
        sync: syncAfterFirstTick,
      },
    });
    expect(delayedDuplicate.status).toBe(409);
    expect(delayedDuplicate.body.error).toBe("sync_mismatch");
    expect(delayedDuplicate.body.action).toBe("input");
    expect(delayedDuplicate.body.desync.tickDelta).toBeLessThanOrEqual(delayedDuplicate.body.desync.maxAllowedTickDelta);

    const reconciledInputSync = flowStateToSync(delayedDuplicate.body.resync.flowState);
    const accepted = await requestJson<{ accepted: boolean }>(`${baseUrl}/v1/rooms/room-http-sync-reconnect/input`, {
      method: "POST",
      authToken: alphaJoin.body.authToken,
      body: {
        sequence: 2,
        thrust: 0.6,
        nowMs: 250,
        sync: reconciledInputSync,
      },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.accepted).toBe(true);

    const duplicatePacket = await requestJson<{ accepted: boolean; reason?: string }>(
      `${baseUrl}/v1/rooms/room-http-sync-reconnect/input`,
      {
        method: "POST",
        authToken: alphaJoin.body.authToken,
        body: {
          sequence: 2,
          thrust: 0.6,
          nowMs: 260,
          sync: reconciledInputSync,
        },
      },
    );
    expect(duplicatePacket.status).toBe(200);
    expect(duplicatePacket.body.accepted).toBe(false);
    expect(duplicatePacket.body.reason).toBe("stale");

    const complete = await requestJson<{ commits: Array<{ playerId: string }>; standings: Array<{ playerId: string }> }>(
      `${baseUrl}/v1/rooms/room-http-sync-reconnect/complete`,
      {
        method: "POST",
        body: {
          recordedAt: 300,
          sync: await getSyncAnchor(baseUrl, "room-http-sync-reconnect"),
        },
      },
    );
    expect(complete.status).toBe(200);
    expect(new Set(complete.body.commits.map((entry) => entry.playerId))).toEqual(new Set(["alpha", "beta"]));
    expect(new Set(complete.body.standings.map((entry) => entry.playerId))).toEqual(new Set(["alpha", "beta"]));

    const desyncEvents = eventSink.list({ type: "session.sync.desync_detected" });
    expect(desyncEvents).toHaveLength(2);
    expect(desyncEvents.map((event) => (event.payload as { action: string }).action).sort()).toEqual(
      ["input", "reconnect"],
    );
    for (const event of desyncEvents) {
      expect(event.payload).toMatchObject({
        sessionId: "room-http-sync-reconnect",
      });
      expect((event.payload as { tickDelta: number; maxAllowedTickDelta: number }).tickDelta).toBeLessThanOrEqual(
        (event.payload as { tickDelta: number; maxAllowedTickDelta: number }).maxAllowedTickDelta,
      );
    }
  });

  it("supports browser CORS preflight for auth + JSON transport calls", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();
    const preflight = await fetch(`${baseUrl}/v1/rooms/room-http-cors/input`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    const allowHeaders = preflight.headers.get("access-control-allow-headers") ?? "";
    expect(allowHeaders.toLowerCase()).toContain("authorization");
    expect(allowHeaders.toLowerCase()).toContain("content-type");
  });

  it("returns CORS headers on auth-gated transport errors for browser clients", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "transport-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();
    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-http-cors-unauthorized",
        nowMs: 0,
      },
    });

    const unauthorizedInput = await fetch(`${baseUrl}/v1/rooms/room-http-cors-unauthorized/input`, {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sequence: 1,
        thrust: 0.2,
        nowMs: 10,
      }),
    });
    const body = (await unauthorizedInput.json()) as { error: string };

    expect(unauthorizedInput.status).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(unauthorizedInput.headers.get("access-control-allow-origin")).toBe("*");
  });
});

interface RequestJsonOptions {
  method: "GET" | "POST";
  authToken?: string;
  body?: unknown;
}

async function requestJson<TBody>(url: string, options: RequestJsonOptions): Promise<JsonResponse<TBody>> {
  const headers: Record<string, string> = {};
  if (options.authToken) {
    headers.authorization = `Bearer ${options.authToken}`;
  }
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as TBody) : (null as TBody);

  return {
    status: response.status,
    body,
  };
}

function flowStateToSync(flowState: MinimalFlowState): SyncAnchor {
  return {
    revision: flowState.revision,
    tick: flowState.world.tick,
    stateHash: flowState.world.stateHash,
  };
}

async function getSyncAnchor(baseUrl: string, sessionId: string): Promise<SyncAnchor> {
  const response = await requestJson<MinimalFlowState>(`${baseUrl}/v1/rooms/${sessionId}/flow-state`, {
    method: "GET",
  });
  return flowStateToSync(response.body);
}
