import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { SessionManager } from "../src/core/session-manager";
import { LeaderboardService } from "../src/leaderboard/leaderboard-service";
import { InMemoryEventSink } from "../src/telemetry/event-sink";
import { HttpRoomTransport } from "../src/transport/http-room-transport";
import { parseSessionIdentityTokenClaimsV1 } from "../src/contracts/wis511-session-identity-event-schema-registry";

interface JsonResponse<TBody = unknown> {
  status: number;
  body: TBody;
}

async function requestJson<TBody = unknown>(
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
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as TBody,
  };
}

async function main(): Promise<void> {
  const eventSink = new InMemoryEventSink();
  const leaderboard = new LeaderboardService({ eventSink });
  const sessions = new SessionManager({ eventSink, leaderboard });
  const transport = new HttpRoomTransport({
    sessions,
    authTokenSecret: "wis511-sample-secret",
    now: () => 0,
  });

  await transport.start({ port: 0 });

  try {
    const baseUrl = transport.baseUrl();
    const sessionId = "room-wis511-sample";

    await requestJson(`${baseUrl}/v1/rooms`, {
      method: "POST",
      body: {
        sessionId,
        nowMs: 0,
      },
    });

    sessions.markTransportConnectFailed(sessionId, 5);

    const join = await requestJson<{ authToken: string }>(`${baseUrl}/v1/rooms/${sessionId}/players`, {
      method: "POST",
      body: {
        playerId: "alpha",
        nowMs: 10,
        spawnHeight: 6,
      },
    });

    const claims = parseSessionIdentityTokenClaimsV1(join.body.authToken);
    if (!claims) {
      throw new Error("failed_to_parse_player_auth_token_claims");
    }

    sessions.submitInput(sessionId, "alpha", { sequence: 1, thrust: 1 }, 20);
    sessions.advanceRoom(sessionId, 100, 100);

    const leaderboardUpdated = eventSink.list({ type: "session.leaderboard.updated" }).at(-1);
    const flowStateUpdated = eventSink.list({ type: "session.flow_state.updated" }).at(-1);
    const degradedSignal = eventSink.list({ type: "session.lifecycle.transport_connect_failed" }).at(-1);

    if (!leaderboardUpdated || !flowStateUpdated || !degradedSignal) {
      throw new Error("missing_expected_sample_events");
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      issue: "WIS-511",
      registryVersion: "1.0.0",
      samples: {
        player_auth_token: {
          schemaId: "session.identity.player_auth_token.v1",
          fields: ["v", "sid", "pid", "exp"],
          samplePayload: claims,
        },
        session_leaderboard_updated: {
          eventType: "session.leaderboard.updated",
          schemaId: "session.leaderboard.updated.v1",
          fields: Object.keys((leaderboardUpdated.payload ?? {}) as Record<string, unknown>),
          samplePayload: leaderboardUpdated.payload,
        },
        session_flow_state_updated: {
          eventType: "session.flow_state.updated",
          schemaId: "session.flow_state.updated.v1",
          fields: Object.keys((flowStateUpdated.payload ?? {}) as Record<string, unknown>),
          samplePayload: flowStateUpdated.payload,
        },
        degraded_confidence_signal: {
          eventType: "session.lifecycle.transport_connect_failed",
          schemaId: "session.lifecycle.transport_connect_failed.v1",
          fields: Object.keys((degradedSignal.payload ?? {}) as Record<string, unknown>),
          samplePayload: degradedSignal.payload,
        },
      },
    } as const;

    const outputPath = resolve(process.cwd(), "docs/ux/evidence/WIS-511-schema-payload-samples.json");
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    console.log(outputPath);
  } finally {
    await transport.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
