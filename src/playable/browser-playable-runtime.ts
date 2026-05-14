export interface BrowserPlayableRuntimeConfig {
  host: string;
  browserPort: number;
  transportPort: number;
  tickMs: number;
  maxTicks: number;
  roomId: string;
  shouldStartInternalTransport: boolean;
  clientTransportBaseUrl: string;
  transportProxyTargetBaseUrl: string | null;
}

export function resolveBrowserPlayableRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): BrowserPlayableRuntimeConfig {
  const host = (env.PLAYABLE_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const browserPort = parsePositiveInt(env.PLAYABLE_BROWSER_PORT ?? env.PORT, 0);
  const transportPort = parsePositiveInt(env.PLAYABLE_TRANSPORT_PORT, 0);
  const tickMs = parsePositiveInt(env.PLAYABLE_TICK_MS, 120);
  const maxTicks = parsePositiveInt(env.PLAYABLE_MAX_TICKS, 220);
  const roomId = env.PLAYABLE_ROOM_ID ?? `browser-room-${nowMs.toString(36)}`;
  const transportProxyTargetBaseUrl = normalizeBaseUrl(env.PLAYABLE_TRANSPORT_PROXY_TARGET);

  return {
    host,
    browserPort,
    transportPort,
    tickMs,
    maxTicks,
    roomId,
    shouldStartInternalTransport: transportProxyTargetBaseUrl === null,
    clientTransportBaseUrl: transportProxyTargetBaseUrl ? "/transport" : "",
    transportProxyTargetBaseUrl,
  };
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  return trimmed.includes("://") ? trimmed : `http://${trimmed}`;
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
