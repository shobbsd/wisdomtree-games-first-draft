export const WIS215_FIRST_SESSION_ONBOARDING_ORDER = Object.freeze([
  "OB-QUEUE-FALLBACK",
  "OB-COUNTDOWN-READY",
  "OB-HAZARD-URGENCY",
] as const);

export type Wis215FirstSessionOnboardingCueId = (typeof WIS215_FIRST_SESSION_ONBOARDING_ORDER)[number];

interface Wis215FirstSessionOnboardingCueContract {
  title: string;
  body: string;
  ctaLabel: "Got it";
  dismissible: true;
  nonBlocking: true;
  triggerUxStateIds: readonly string[];
  suppressedUxStateIds: readonly string[];
}

export const WIS215_FIRST_SESSION_ONBOARDING_CUES: Record<
  Wis215FirstSessionOnboardingCueId,
  Wis215FirstSessionOnboardingCueContract
> = Object.freeze({
  "OB-QUEUE-FALLBACK": Object.freeze({
    title: "Couldn’t find a match yet",
    body: "Tip: Retry keeps queue active. Create Room starts immediately with your own lobby.",
    ctaLabel: "Got it",
    dismissible: true,
    nonBlocking: true,
    triggerUxStateIds: Object.freeze(["TS-CONNECT-FAILED"]),
    suppressedUxStateIds: Object.freeze(["HUD-ELIMINATED"]),
  }),
  "OB-COUNTDOWN-READY": Object.freeze({
    title: "Match starts in 3",
    body: "Ready state gates countdown start. Stay connected and marked ready to avoid cancellation.",
    ctaLabel: "Got it",
    dismissible: true,
    nonBlocking: true,
    triggerUxStateIds: Object.freeze(["PM-COUNTDOWN"]),
    suppressedUxStateIds: Object.freeze(["HUD-ELIMINATED"]),
  }),
  "OB-HAZARD-URGENCY": Object.freeze({
    title: "Ground Rising Faster",
    body: "When warning escalates toward Critical Rise Speed, prioritize vertical movement immediately.",
    ctaLabel: "Got it",
    dismissible: true,
    nonBlocking: true,
    triggerUxStateIds: Object.freeze(["HUD-ACTIVE"]),
    suppressedUxStateIds: Object.freeze(["HUD-ELIMINATED"]),
  }),
});

export function isWis215FirstSessionOnboardingCueId(value: string): value is Wis215FirstSessionOnboardingCueId {
  return (WIS215_FIRST_SESSION_ONBOARDING_ORDER as readonly string[]).includes(value);
}
