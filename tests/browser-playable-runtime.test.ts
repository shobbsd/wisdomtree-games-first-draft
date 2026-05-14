import { describe, expect, it } from "vitest";

import { resolveBrowserPlayableRuntimeConfig } from "../src/playable/browser-playable-runtime";

describe("browser playable runtime config", () => {
  it("uses the Render port and proxy mode when an external transport target is configured", () => {
    const config = resolveBrowserPlayableRuntimeConfig(
      {
        PLAYABLE_HOST: "0.0.0.0",
        PLAYABLE_ROOM_ID: "render-room",
        PLAYABLE_TRANSPORT_PROXY_TARGET: "multiplayer-api:10000",
        PORT: "10000",
      },
      1_715_692_800_000,
    );

    expect(config).toMatchObject({
      host: "0.0.0.0",
      browserPort: 10000,
      roomId: "render-room",
      shouldStartInternalTransport: false,
      clientTransportBaseUrl: "/transport",
      transportProxyTargetBaseUrl: "http://multiplayer-api:10000",
    });
  });

  it("keeps standalone local mode when no proxy target is configured", () => {
    const config = resolveBrowserPlayableRuntimeConfig(
      {
        PLAYABLE_BROWSER_PORT: "4311",
        PLAYABLE_HOST: "127.0.0.1",
        PLAYABLE_MAX_TICKS: "250",
        PLAYABLE_ROOM_ID: "local-room",
        PLAYABLE_TICK_MS: "90",
        PLAYABLE_TRANSPORT_PORT: "4312",
      },
      1_715_692_800_000,
    );

    expect(config).toMatchObject({
      host: "127.0.0.1",
      browserPort: 4311,
      transportPort: 4312,
      tickMs: 90,
      maxTicks: 250,
      roomId: "local-room",
      shouldStartInternalTransport: true,
      clientTransportBaseUrl: "",
      transportProxyTargetBaseUrl: null,
    });
  });
});
