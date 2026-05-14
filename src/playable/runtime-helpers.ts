import type { PlayerSnapshot } from "../types.js";

const BOT_EMERGENCY_CLEARANCE = 0.4;
const BOT_SAFE_CLEARANCE = 1.8;
const BOT_EMERGENCY_DESCENT_VELOCITY = -0.8;
const BOT_SAFE_ASCENT_VELOCITY = 0.25;
const BOT_CRUISE_THRUST = 0.35;
const BOT_DESCENT_THRUST = -0.2;

export function chooseBotThrust(
  player: PlayerSnapshot | undefined,
  groundHeight: number,
): number {
  if (!player || !player.connected || player.isEliminated) {
    return 0;
  }

  const clearance = player.height - groundHeight;
  if (clearance <= BOT_EMERGENCY_CLEARANCE || player.velocity < BOT_EMERGENCY_DESCENT_VELOCITY) {
    return 1;
  }

  if (clearance >= BOT_SAFE_CLEARANCE && player.velocity > BOT_SAFE_ASCENT_VELOCITY) {
    return BOT_DESCENT_THRUST;
  }

  return BOT_CRUISE_THRUST;
}

export function shouldCompleteRound(
  players: PlayerSnapshot[],
  tickCount: number,
  maxTicks: number,
): boolean {
  if (tickCount >= maxTicks) {
    return true;
  }

  return players.length > 0 && players.every((player) => player.isEliminated);
}
