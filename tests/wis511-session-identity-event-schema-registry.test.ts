import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";
import { HttpRoomTransport } from "../src/transport/http-room-transport";
import {
  WIS511_EVENT_SCHEMAS,
  WIS511_REQUIRED_ANALYTICS_EVENT_SET,
  WIS511_SCHEMA_REGISTRY_VERSION,
  WIS511_SESSION_IDENTITY_TOKEN_SCHEMA_ID,
  parseSessionIdentityTokenClaimsV1,
  validateRequiredAnalyticsEventSet,
  validateSessionIdentityTokenClaimsV1,
} from "../src/contracts/wis511-session-identity-event-schema-registry";

interface Wis511Fixture {
  registryVersion?: string;
  identityTokenSchemaId?: string;
  eventSchemaIds?: Record<string, string>;
  requiredEventSet?: Array<{
    id: string;
    eventTypes: string[];
    minCount: number;
  }>;
}

interface JsonResponse<TBody> {
  status: number;
  body: TBody;
}

function loadWis511Fixture(): Wis511Fixture {
  const fixturePath = resolve(process.cwd(), "docs/ux/WIS-511-session-identity-event-schema-registry-v1.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Wis511Fixture;
}

describe("WIS-511 session identity + event schema registry v1", () => {
  let transport: HttpRoomTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.stop();
      transport = null;
    }
  });

  it("locks registry metadata + required event set to fixture", () => {
    const fixture = loadWis511Fixture();
    const schemaIds = Object.fromEntries(
      Object.entries(WIS511_EVENT_SCHEMAS).map(([eventType, definition]) => [eventType, definition.schemaId]),
    );
    const requiredEventSet = WIS511_REQUIRED_ANALYTICS_EVENT_SET.map((entry) => ({
      id: entry.id,
      eventTypes: [...entry.eventTypes],
      minCount: entry.minCount,
    }));

    expect(fixture.registryVersion).toBe(WIS511_SCHEMA_REGISTRY_VERSION);
    expect(fixture.identityTokenSchemaId).toBe(WIS511_SESSION_IDENTITY_TOKEN_SCHEMA_ID);
    expect(fixture.eventSchemaIds).toEqual(schemaIds);
    expect(fixture.requiredEventSet).toEqual(requiredEventSet);
  });

  it("validates issued player auth token payload against identity token schema v1", async () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    transport = new HttpRoomTransport({
      sessions,
      authTokenSecret: "wis511-schema-test-secret",
      now: () => 0,
    });
    await transport.start({ port: 0 });

    const baseUrl = transport.baseUrl();
    await requestJson<{ sessionId: string }>(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId: "room-wis511-auth",
        nowMs: 0,
      },
    });
    const join = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/room-wis511-auth/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 10,
      },
    });

    expect(join.status).toBe(201);
    const claims = parseSessionIdentityTokenClaimsV1(join.body.authToken);
    expect(claims).toEqual({
      v: 1,
      sid: "room-wis511-auth",
      pid: "alpha",
      exp: 3_600_010,
    });

    expect(validateSessionIdentityTokenClaimsV1(claims)).toMatchObject({
      valid: true,
      errors: [],
    });
    expect(validateSessionIdentityTokenClaimsV1({ v: 2, sid: "room", pid: "alpha", exp: 1 })).toMatchObject({
      valid: false,
    });
  });

  it("validates required analytics minimum event set against live authoritative runtime emissions", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });
    const sessionId = "room-wis511-events";

    sessions.createRoom({ sessionId, nowMs: 0 });
    sessions.markTransportConnectFailed(sessionId, 5);
    sessions.joinRoom(sessionId, "alpha", { nowMs: 10, spawnHeight: 6 });

    sessions.submitInput(sessionId, "alpha", { sequence: 1, thrust: 1 }, 20);
    sessions.advanceRoom(sessionId, 100, 100);
    sessions.advanceRoom(sessionId, 1_600, 1_700);
    sessions.advanceRoom(sessionId, 1_900, 3_600);
    sessions.submitInput(sessionId, "alpha", { sequence: 2, thrust: -1 }, 3_610);
    sessions.advanceRoom(sessionId, 3_000, 6_600);

    const events = eventSink.list({ limit: 10_000 });
    expect(events.some((event) => event.type === "rg.elimination.triggered")).toBe(true);

    const validation = validateRequiredAnalyticsEventSet(events);
    expect(validation).toEqual({
      valid: true,
      missingRequirements: [],
      invalidEvents: [],
    });
  });

  it("reports missing required analytics requirements when event stream is incomplete", () => {
    const eventSink = new InMemoryEventSink();
    const leaderboard = new LeaderboardService({ eventSink });
    const sessions = new SessionManager({ eventSink, leaderboard });

    sessions.createRoom({ sessionId: "room-wis511-incomplete", nowMs: 0 });

    const validation = validateRequiredAnalyticsEventSet(eventSink.list({ limit: 1_000 }));
    expect(validation.valid).toBe(false);
    expect(new Set(validation.missingRequirements)).toEqual(
      new Set([
        "session_lifecycle_player_joined",
        "input_acceptance",
        "elimination_signal",
        "degraded_confidence_signal",
      ]),
    );
    expect(validation.invalidEvents).toEqual([]);
  });
});

async function requestJson<TBody>(
  url: string,
  options: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
  },
): Promise<JsonResponse<TBody>> {
  const response = await fetch(url, {
    method: options.method,
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as TBody) : ({} as TBody);

  return {
    status: response.status,
    body,
  };
}
