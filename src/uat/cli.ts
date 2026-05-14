import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createBaselineRuntime } from "../index.js";
import { HttpRoomTransport } from "../transport/http-room-transport.js";
import { UAT_DETERMINISTIC_SEED_ROUNDS, resolveUatRuntimeProfile } from "./runtime-profile.js";
import { resetUatDurableState, seedDeterministicUatState } from "./state-seed.js";

const command = process.argv[2] ?? "help";
const profile = resolveUatRuntimeProfile();

switch (command) {
  case "profile": {
    printJson({
      runtime: profile,
      deterministicSeedProfile: {
        rounds: UAT_DETERMINISTIC_SEED_ROUNDS,
      },
      commands: {
        start: "npm run uat:start",
        stop: "npm run uat:stop",
        reset: "npm run uat:reset",
        seed: "npm run uat:seed",
      },
    });
    break;
  }
  case "reset": {
    const result = resetUatDurableState(profile.durableStateFilePath);
    rmSync(profile.seedSummaryFilePath, { force: true });
    printJson({
      event: "uat_state_reset",
      ...result,
    });
    break;
  }
  case "seed": {
    const summary = seedDeterministicUatState({
      stateFilePath: profile.durableStateFilePath,
      summaryFilePath: profile.seedSummaryFilePath,
    });
    printJson({
      event: "uat_state_seeded",
      summaryFilePath: profile.seedSummaryFilePath,
      summary,
    });
    break;
  }
  case "serve": {
    await runUatServer();
    break;
  }
  default: {
    console.error("Usage: tsx src/uat/cli.ts <profile|reset|seed|serve>");
    process.exitCode = 1;
  }
}

async function runUatServer(): Promise<void> {
  const runtime = createBaselineRuntime({
    durableStateFilePath: profile.durableStateFilePath,
  });
  const transport = new HttpRoomTransport({
    sessions: runtime.sessions,
    authTokenSecret: profile.authTokenSecret,
    authTokenTtlMs: profile.authTokenTtlMs,
  });
  const started = await transport.start({
    host: profile.host,
    port: profile.port,
  });

  const statusPayload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: started.host,
    port: started.port,
    url: started.url,
    healthUrl: profile.healthUrl,
    durableStateFilePath: profile.durableStateFilePath,
  };

  mkdirSync(dirname(profile.statusFilePath), { recursive: true });
  writeFileSync(profile.statusFilePath, `${JSON.stringify(statusPayload, null, 2)}\n`, "utf8");
  printJson({
    event: "uat_server_started",
    ...statusPayload,
  });

  let shutdownInFlight = false;
  const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
    if (shutdownInFlight) {
      return;
    }

    shutdownInFlight = true;
    await transport.stop();
    rmSync(profile.statusFilePath, { force: true });
    printJson({
      event: "uat_server_stopped",
      signal,
      stoppedAt: new Date().toISOString(),
    });
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await new Promise<void>(() => {
    // keep process alive until signal handlers stop transport
  });
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
