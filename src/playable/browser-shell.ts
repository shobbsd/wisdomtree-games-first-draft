export type BrowserSurfaceMode = "desktop" | "mobile";
export type BrowserSurfacePreference = "auto" | BrowserSurfaceMode;
export type BrowserTouchMode = "none" | "up" | "down" | "left" | "right" | "neutral";

export interface BrowserControlState {
  keyboardLiftActive: boolean;
  keyboardDropActive: boolean;
  keyboardLeftActive: boolean;
  keyboardRightActive: boolean;
  touchMode: BrowserTouchMode;
}

export interface BrowserDirectionalControlIntent {
  thrust: number;
  horizontal: number;
}

export type BrowserSpriteAnimationState = "idle" | "run" | "jump_up" | "jump_down" | "dead";

export interface BrowserSpriteAnimationInput {
  isEliminated: boolean;
  onPlatform: boolean;
  horizontalIntent: number;
  verticalVelocity: number;
  thrustIntent: number;
}

export interface SurfaceProbe {
  viewportWidth: number;
  coarsePointer: boolean;
}

export interface BrowserPlayableHtmlOptions {
  title: string;
  roomId: string;
  transportBaseUrl: string;
  tickMs: number;
  maxTicks: number;
}

const MOBILE_VIEWPORT_MAX = 920;
const PLAYFIELD_CANVAS_WIDTH = 960;
const PLAYFIELD_CANVAS_HEIGHT = 360;
const RUN_INTENT_THRESHOLD = 0.24;
const ASCENT_VELOCITY_THRESHOLD = 0.12;
const ASCENT_THRUST_THRESHOLD = 0.2;

function toInlineSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const BROWSER_SPRITE_ATLAS = Object.freeze({
  playerYou: toInlineSvgDataUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='4' fill='#082032'/><rect x='4' y='3' width='16' height='18' rx='4' fill='#22d3ee'/><circle cx='9' cy='10' r='1.6' fill='#0f172a'/><circle cx='15' cy='10' r='1.6' fill='#0f172a'/><rect x='8' y='14' width='8' height='4' rx='2' fill='#cffafe'/></svg>",
  ),
  playerBot: toInlineSvgDataUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='4' fill='#2b1b08'/><rect x='4' y='3' width='16' height='18' rx='4' fill='#fb923c'/><circle cx='9' cy='10' r='1.6' fill='#3f1d0d'/><circle cx='15' cy='10' r='1.6' fill='#3f1d0d'/><rect x='8' y='14' width='8' height='4' rx='2' fill='#ffedd5'/></svg>",
  ),
  hazardGround: toInlineSvgDataUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 18'><rect width='48' height='18' fill='#1f2937'/><path d='M0 18 L8 4 L16 18 Z M16 18 L24 4 L32 18 Z M32 18 L40 4 L48 18 Z' fill='#f97316'/><rect y='14' width='48' height='4' fill='#374151'/></svg>",
  ),
  hazardSky: toInlineSvgDataUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 24'><rect width='48' height='24' fill='#0f172a'/><path d='M0 20 L12 6 L24 20 L36 2 L48 20' fill='none' stroke='#fb7185' stroke-width='2'/><circle cx='8' cy='7' r='1.2' fill='#fda4af'/><circle cx='24' cy='10' r='1.2' fill='#fda4af'/><circle cx='40' cy='6' r='1.2' fill='#fda4af'/></svg>",
  ),
  flame: toInlineSvgDataUrl(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M8 1 C9 4 12 5 12 9 C12 12 10 15 8 15 C6 15 4 12 4 9 C4 6 6 4 8 1 Z' fill='#f97316'/><path d='M8 4 C8.6 6 10 7 10 9.2 C10 10.8 9 13 8 13 C7 13 6 10.8 6 9.2 C6 7.6 6.8 6 8 4 Z' fill='#fde68a'/></svg>",
  ),
});

export function resolveSurfaceMode(
  preference: BrowserSurfacePreference,
  probe: SurfaceProbe,
): BrowserSurfaceMode {
  if (preference === "desktop" || preference === "mobile") {
    return preference;
  }

  if (probe.coarsePointer || probe.viewportWidth <= MOBILE_VIEWPORT_MAX) {
    return "mobile";
  }

  return "desktop";
}

export function resolveDirectionalControlIntent(state: BrowserControlState): BrowserDirectionalControlIntent {
  if (state.touchMode === "up") {
    return { thrust: 1, horizontal: 0 };
  }
  if (state.touchMode === "down") {
    return { thrust: -0.5, horizontal: 0 };
  }
  if (state.touchMode === "left") {
    return { thrust: 0, horizontal: -1 };
  }
  if (state.touchMode === "right") {
    return { thrust: 0, horizontal: 1 };
  }
  if (state.touchMode === "neutral") {
    return { thrust: 0, horizontal: 0 };
  }

  const thrust = state.keyboardLiftActive === state.keyboardDropActive ? 0 : state.keyboardLiftActive ? 1 : -0.5;
  const horizontal =
    state.keyboardLeftActive === state.keyboardRightActive ? 0 : state.keyboardLeftActive ? -1 : 1;
  return { thrust, horizontal };
}

export function resolveControlIntent(state: BrowserControlState): number {
  return resolveDirectionalControlIntent(state).thrust;
}

export function resolveSpriteAnimationState(input: BrowserSpriteAnimationInput): BrowserSpriteAnimationState {
  if (input.isEliminated) {
    return "dead";
  }

  if (!input.onPlatform) {
    if (input.verticalVelocity >= ASCENT_VELOCITY_THRESHOLD || input.thrustIntent >= ASCENT_THRUST_THRESHOLD) {
      return "jump_up";
    }
    return "jump_down";
  }

  if (Math.abs(input.horizontalIntent) >= RUN_INTENT_THRESHOLD) {
    return "run";
  }

  return "idle";
}

export function renderBrowserPlayableHtml(options: BrowserPlayableHtmlOptions): string {
  const payload = JSON.stringify({
    roomId: options.roomId,
    transportBaseUrl: options.transportBaseUrl,
    tickMs: options.tickMs,
    maxTicks: options.maxTicks,
    defaultSurface: "auto",
    humanPlayerId: "you",
    botPlayerId: "bot",
    sprites: BROWSER_SPRITE_ATLAS,
    playfield: {
      width: PLAYFIELD_CANVAS_WIDTH,
      height: PLAYFIELD_CANVAS_HEIGHT,
    },
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg-deep: #0b1020;
        --surface-lane: #14263a;
        --surface-panel: #1b2333;
        --accent-velocity: #32d8ff;
        --accent-danger: #ff5a5f;
        --accent-success: #39d98a;
        --accent-rank: #ffc857;
        --text-primary: #f5f8ff;
        --text-secondary: #b7c2d9;
        --bg: var(--bg-deep);
        --bg-soft: var(--surface-lane);
        --panel: var(--surface-panel);
        --panel-strong: #1d2f57;
        --text: var(--text-primary);
        --muted: var(--text-secondary);
        --ok: var(--accent-success);
        --warn: var(--accent-rank);
        --danger: var(--accent-danger);
        --accent: var(--accent-velocity);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        font-family: "Manrope", "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 20% 10%, #17203d 0%, transparent 40%),
          radial-gradient(circle at 80% 0%, #12344a 0%, transparent 34%),
          linear-gradient(180deg, #030711 0%, #081126 46%, #04060f 100%);
      }

      main {
        width: min(1120px, 100%);
        margin: 0 auto;
        padding: 16px;
        display: grid;
        gap: 14px;
      }

      .panel {
        background: linear-gradient(160deg, rgba(29, 47, 87, 0.55), rgba(9, 16, 31, 0.8));
        border: 1px solid rgba(148, 163, 184, 0.26);
        border-radius: 14px;
        padding: 12px;
        box-shadow: 0 6px 30px rgba(2, 6, 23, 0.45);
      }

      .hero {
        display: grid;
        gap: 8px;
      }

      h1 {
        margin: 0;
        font-size: clamp(1.15rem, 2.4vw, 1.6rem);
        font-family: "Sora", "Manrope", "Segoe UI", sans-serif;
      }

      .meta {
        color: var(--muted);
        font-size: 0.95rem;
        display: grid;
        gap: 4px;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .objective-ribbon {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(50, 216, 255, 0.45);
        border-radius: 999px;
        padding: 8px 12px;
        background: rgba(12, 36, 56, 0.72);
      }

      .objective-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border-radius: 999px;
        background: rgba(50, 216, 255, 0.22);
        color: #c8f4ff;
        font-size: 0.8rem;
        font-weight: 700;
      }

      .objective-copy {
        color: var(--text-primary);
        font-size: 0.88rem;
        font-weight: 600;
      }

      .objective-progress {
        color: #fff0c2;
        font-family: "JetBrains Mono", "Menlo", "Consolas", monospace;
        font-size: 0.78rem;
        font-weight: 700;
      }

      .chip {
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 0.78rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        border: 1px solid rgba(148, 163, 184, 0.36);
        background: rgba(9, 17, 32, 0.72);
      }

      .chip.is-live {
        border-color: rgba(74, 222, 128, 0.45);
        color: #bbf7d0;
      }

      .chip.is-error {
        border-color: rgba(248, 113, 113, 0.45);
        color: #fecaca;
      }

      .surface-toggles {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .surface-btn {
        border: 1px solid rgba(125, 211, 252, 0.4);
        border-radius: 10px;
        background: rgba(2, 132, 199, 0.2);
        color: var(--text);
        font: inherit;
        font-size: 0.9rem;
        padding: 6px 10px;
        cursor: pointer;
      }

      .surface-btn[aria-pressed="true"] {
        background: rgba(56, 189, 248, 0.36);
        border-color: rgba(56, 189, 248, 0.88);
      }

      .grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .hud-grid {
        margin: 0;
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .hud-grid > div {
        background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 10px;
        padding: 8px 10px;
      }

      .hud-grid dt {
        margin: 0;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 600;
      }

      .hud-grid dd {
        margin: 4px 0 0;
        font-size: 1.02rem;
        font-weight: 700;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .action-btn {
        border: 1px solid rgba(148, 163, 184, 0.38);
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.82);
        color: var(--text);
        font: inherit;
        font-size: 0.88rem;
        padding: 8px 10px;
        cursor: pointer;
      }

      .action-btn.primary {
        border-color: rgba(74, 222, 128, 0.55);
        background: rgba(20, 83, 45, 0.62);
      }

      .action-btn:disabled {
        opacity: 0.55;
        cursor: default;
      }

      .action-note {
        margin: 0;
        color: var(--muted);
        font-size: 0.88rem;
      }

      #elim-panel[hidden],
      #results-panel[hidden] {
        display: none;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 6px 8px;
        text-align: left;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }

      th {
        color: #bcd0f3;
        font-weight: 600;
      }

      td.muted {
        color: var(--muted);
      }

      td.delta-pos {
        color: #9cf6c8;
      }

      td.delta-neg {
        color: #ffb3b6;
      }

      #keyboard-hints,
      #touch-controls {
        display: none;
      }

      #keyboard-hints p {
        margin: 0;
        color: #c7d6ef;
      }

      .control-hint-dock {
        margin-top: 8px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .hint-chip {
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.4);
        padding: 5px 10px;
        font-size: 0.77rem;
        font-weight: 600;
        color: #d6e4ff;
        background: rgba(12, 18, 32, 0.78);
      }

      .hint-chip.is-cleared {
        border-color: rgba(57, 217, 138, 0.48);
        color: #baf7d7;
      }

      #touch-controls {
        display: none;
        gap: 10px;
      }

      #touch-controls button {
        flex: 1 1 0;
        border: 1px solid rgba(148, 163, 184, 0.38);
        border-radius: 12px;
        background: rgba(23, 37, 64, 0.88);
        color: #e4efff;
        font: inherit;
        font-weight: 700;
        padding: 12px 8px;
        min-height: 52px;
        cursor: pointer;
        user-select: none;
        touch-action: none;
      }

      #touch-controls button.is-active {
        border-color: rgba(56, 189, 248, 0.95);
        background: rgba(12, 74, 110, 0.95);
      }

      .playfield-panel {
        display: grid;
        gap: 10px;
      }

      .playfield-wrap {
        position: relative;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.3);
        overflow: hidden;
        background:
          radial-gradient(circle at 20% 12%, rgba(34, 211, 238, 0.18), transparent 32%),
          linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(7, 11, 24, 0.96));
      }

      #playfield-canvas {
        display: block;
        width: 100%;
        height: auto;
        max-height: min(58vh, 420px);
        image-rendering: pixelated;
      }

      .playfield-overlay {
        position: absolute;
        inset: 10px auto auto 10px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.8rem;
        letter-spacing: 0.01em;
        color: #dbeafe;
        background: rgba(2, 6, 23, 0.62);
        border: 1px solid rgba(148, 163, 184, 0.42);
        pointer-events: none;
      }

      [data-surface="desktop"] #keyboard-hints {
        display: block;
      }

      [data-surface="mobile"] #touch-controls {
        display: flex;
      }

      [data-surface="mobile"] .playfield-overlay {
        font-size: 0.75rem;
        inset: 8px auto auto 8px;
      }

      .alert {
        border-radius: 12px;
        padding: 9px 11px;
        font-size: 0.92rem;
        border: 1px solid rgba(148, 163, 184, 0.3);
        background: rgba(15, 23, 42, 0.64);
      }

      .alert.warn {
        border-color: rgba(245, 158, 11, 0.45);
        color: #fcd34d;
      }

      .alert.error {
        border-color: rgba(248, 113, 113, 0.6);
        color: #fecaca;
      }

      @media (max-width: 1120px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 880px) {
        .grid {
          grid-template-columns: 1fr;
        }

        .hud-grid {
          grid-template-columns: 1fr;
        }

        .objective-ribbon {
          grid-template-columns: 1fr;
          border-radius: 12px;
        }

        .objective-progress {
          justify-self: start;
        }
      }
    </style>
  </head>
  <body data-surface="desktop">
    <main>
      <section class="panel hero">
        <h1>${escapeHtml(options.title)}</h1>
        <div class="meta">
          <div id="status-line">Booting browser shell...</div>
          <div id="phase-line">Phase: waiting</div>
        </div>
        <div class="objective-ribbon" id="objective-ribbon" role="status" aria-live="polite">
          <span class="objective-icon" id="objective-icon">▲</span>
          <span class="objective-copy" id="objective-copy">Objective: Stay above hazard and clear first checkpoint.</span>
          <span class="objective-progress" id="objective-progress">Step 1/2</span>
        </div>
        <div class="chips">
          <span class="chip" id="surface-chip">Surface: auto</span>
          <span class="chip" id="loop-chip">Loop: idle</span>
        </div>
        <div class="surface-toggles">
          <button type="button" class="surface-btn" data-surface-pref="auto" aria-pressed="true">Auto Surface</button>
          <button type="button" class="surface-btn" data-surface-pref="desktop" aria-pressed="false">Desktop Surface</button>
          <button type="button" class="surface-btn" data-surface-pref="mobile" aria-pressed="false">Mobile Surface</button>
        </div>
      </section>

      <section class="panel">
        <div id="keyboard-hints">
          <p><strong>Desktop controls:</strong> <code>W</code>/<code>Space</code>/<code>ArrowUp</code> jump up, <code>S</code>/<code>ArrowDown</code> fast drop, <code>A</code>/<code>D</code> or arrows run left/right.</p>
        </div>
        <div id="touch-controls">
          <button type="button" data-control="up">Up</button>
          <button type="button" data-control="left">Left</button>
          <button type="button" data-control="neutral">Neutral</button>
          <button type="button" data-control="right">Right</button>
          <button type="button" data-control="down">Down</button>
        </div>
        <div class="control-hint-dock" id="control-hint-dock">
          <span class="hint-chip" id="hint-lift">Lift once to clear first lane</span>
          <span class="hint-chip" id="hint-drop">Drop to stabilize before hazard crest</span>
          <span class="hint-chip" id="hint-left">Move left to test platform bounds</span>
          <span class="hint-chip" id="hint-right">Move right to sprint animation</span>
        </div>
      </section>

      <section class="panel playfield-panel">
        <h2>Playable Arena</h2>
        <div class="playfield-wrap">
          <canvas
            id="playfield-canvas"
            width="${PLAYFIELD_CANVAS_WIDTH}"
            height="${PLAYFIELD_CANVAS_HEIGHT}"
            aria-label="Gameplay arena"
          ></canvas>
          <div class="playfield-overlay" id="playfield-overlay">Waiting for first tick...</div>
        </div>
        <p class="action-note">Sprites map player movement, rising hazard pressure, elimination impact, and replay restarts.</p>
      </section>

      <section class="grid">
        <article class="panel">
          <h2>Your HUD</h2>
          <dl class="hud-grid">
            <div>
              <dt>Rank</dt>
              <dd id="hud-rank">--</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd id="hud-score">--</dd>
            </div>
            <div>
              <dt>Survival Time</dt>
              <dd id="hud-survival">--</dd>
            </div>
            <div>
              <dt>Ground Speed</dt>
              <dd id="hud-ground-speed">--</dd>
            </div>
            <div>
              <dt>Players Left</dt>
              <dd id="hud-players-left">--</dd>
            </div>
          </dl>
        </article>

        <article class="panel table-wrap">
          <h2>Live Standings</h2>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Score</th>
                <th>Height</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="live-standings"></tbody>
          </table>
        </article>

        <article class="panel table-wrap">
          <h2>Final Standings</h2>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Score</th>
                <th>Prev</th>
                <th>Now</th>
                <th>Δ</th>
                <th>Tie</th>
              </tr>
            </thead>
            <tbody id="final-standings"></tbody>
          </table>
        </article>
      </section>

      <section class="panel table-wrap">
        <h2>Global Leaderboard</h2>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Score</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody id="global-standings"></tbody>
        </table>
      </section>

      <section class="panel" id="elim-panel" hidden>
        <h2 id="elim-headline">Elimination Transition</h2>
        <div class="meta">
          <div id="elim-helper">You can spectate now or view results.</div>
          <div id="elim-cause">Cause: waiting</div>
          <div id="elim-countdown">Respawn: --</div>
          <div id="elim-next-action">Next action: --</div>
          <div id="elim-state">Waiting for elimination state.</div>
        </div>
        <div class="action-row" id="elim-actions"></div>
        <p class="action-note" id="elim-outcome"></p>
      </section>

      <section class="panel" id="results-panel" hidden>
        <h2>Match Complete</h2>
        <div class="meta">
          <div id="final-placement">Final Placement: --</div>
          <div id="results-status">Waiting for results lifecycle...</div>
          <div id="results-guidance">Choose your next step. You can rematch now or leave the room.</div>
        </div>
        <div class="action-row" id="results-actions">
          <button type="button" class="action-btn primary" data-results-action="REPLAY_MATCH">Play Again (Replay Match)</button>
          <button type="button" class="action-btn" data-results-action="BACK_TO_LOBBY">Back to Lobby</button>
          <button type="button" class="action-btn" data-results-action="EXIT_TO_MENU">Exit to Menu</button>
        </div>
        <button type="button" class="action-btn" id="results-ack" hidden>OK</button>
        <p class="action-note" id="results-outcome"></p>
      </section>

      <section class="panel">
        <div class="alert warn" id="rising-copy" aria-live="polite">Waiting for rising-ground telemetry...</div>
        <div class="alert" id="error-box">No transport errors.</div>
      </section>
    </main>
    <script>
      window.__BROWSER_PLAYABLE_CONFIG__ = ${payload};
    </script>
    <script>
${BROWSER_PLAYABLE_CLIENT_SCRIPT}
    </script>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const BROWSER_PLAYABLE_CLIENT_SCRIPT = String.raw`(() => {
  const config = window.__BROWSER_PLAYABLE_CONFIG__;
  if (!config) {
    return;
  }

  function allocateRoomId(baseRoomId) {
    return baseRoomId + "-" + Date.now().toString(36);
  }

  const state = {
    roomId: allocateRoomId(config.roomId),
    roundOrdinal: 1,
    humanPlayerId: config.humanPlayerId || "you",
    botPlayerId: config.botPlayerId || "bot",
    authTokens: {},
    sequences: {},
    flowState: null,
    roundResult: null,
    globalLeaderboard: [],
    running: true,
    surfacePreference: config.defaultSurface || "auto",
    resolvedSurface: "desktop",
    controls: {
      keyboardLiftActive: false,
      keyboardDropActive: false,
      keyboardLeftActive: false,
      keyboardRightActive: false,
      touchMode: "none"
    },
    tickInFlight: false,
    loopHandle: null,
    errorMessage: null,
    postMatchAttempt: null,
    eliminationSelection: null,
    actionRequestInFlight: false,
    spriteImages: {},
    spritesReady: false,
    lastIntentByPlayer: {},
    lastDirectionalIntentByPlayer: {},
    playerRenderStateByPlayer: {},
    lastTickDeltaMs: Number(config.tickMs) || 120,
    playfieldMessage: "Waiting for first tick...",
    hintAcknowledged: {
      lift: false,
      drop: false,
      left: false,
      right: false
    }
  };

  const statusLine = document.getElementById("status-line");
  const phaseLine = document.getElementById("phase-line");
  const objectiveRibbon = document.getElementById("objective-ribbon");
  const objectiveIcon = document.getElementById("objective-icon");
  const objectiveCopy = document.getElementById("objective-copy");
  const objectiveProgress = document.getElementById("objective-progress");
  const surfaceChip = document.getElementById("surface-chip");
  const loopChip = document.getElementById("loop-chip");
  const risingCopy = document.getElementById("rising-copy");
  const errorBox = document.getElementById("error-box");
  const liveStandings = document.getElementById("live-standings");
  const finalStandings = document.getElementById("final-standings");
  const globalStandings = document.getElementById("global-standings");
  const hudRank = document.getElementById("hud-rank");
  const hudScore = document.getElementById("hud-score");
  const hudSurvival = document.getElementById("hud-survival");
  const hudGroundSpeed = document.getElementById("hud-ground-speed");
  const hudPlayersLeft = document.getElementById("hud-players-left");
  const playfieldCanvas = document.getElementById("playfield-canvas");
  const playfieldOverlay = document.getElementById("playfield-overlay");
  const eliminationPanel = document.getElementById("elim-panel");
  const eliminationHeadline = document.getElementById("elim-headline");
  const eliminationHelper = document.getElementById("elim-helper");
  const eliminationCause = document.getElementById("elim-cause");
  const eliminationCountdown = document.getElementById("elim-countdown");
  const eliminationNextAction = document.getElementById("elim-next-action");
  const eliminationState = document.getElementById("elim-state");
  const eliminationActions = document.getElementById("elim-actions");
  const eliminationOutcome = document.getElementById("elim-outcome");
  const resultsPanel = document.getElementById("results-panel");
  const finalPlacement = document.getElementById("final-placement");
  const resultsStatus = document.getElementById("results-status");
  const resultsGuidance = document.getElementById("results-guidance");
  const resultsActions = document.getElementById("results-actions");
  const resultsAck = document.getElementById("results-ack");
  const resultsOutcome = document.getElementById("results-outcome");
  const controlHintDock = document.getElementById("control-hint-dock");
  const hintLift = document.getElementById("hint-lift");
  const hintDrop = document.getElementById("hint-drop");
  const hintLeft = document.getElementById("hint-left");
  const hintRight = document.getElementById("hint-right");
  const surfaceButtons = Array.from(document.querySelectorAll("[data-surface-pref]"));
  const touchButtons = Array.from(document.querySelectorAll("#touch-controls [data-control]"));

  bindSurfaceButtons();
  bindKeyboardControls();
  bindTouchControls();
  bindEliminationActions();
  bindResultsActions();
  applySurfaceMode();

  window.addEventListener("resize", applySurfaceMode);

  void bootstrap().catch((error) => {
    state.running = false;
    setError("bootstrap_failed: " + getErrorMessage(error));
    render();
  });

  async function bootstrap() {
    statusLine.textContent = "Loading sprites...";
    await loadSprites();
    statusLine.textContent = "Creating room " + state.roomId + "...";
    await createRoom();
    state.authTokens[state.humanPlayerId] = await joinPlayer(state.humanPlayerId, 4.8);
    state.authTokens[state.botPlayerId] = await joinPlayer(state.botPlayerId, 5.0);
    state.sequences[state.humanPlayerId] = 0;
    state.sequences[state.botPlayerId] = 0;
    state.lastIntentByPlayer[state.humanPlayerId] = 0;
    state.lastIntentByPlayer[state.botPlayerId] = 0;
    state.lastDirectionalIntentByPlayer[state.humanPlayerId] = { thrust: 0, horizontal: 0 };
    state.lastDirectionalIntentByPlayer[state.botPlayerId] = { thrust: 0, horizontal: 0 };
    state.flowState = await getFlowState();
    statusLine.textContent = "Room live. Loop active. Round " + state.roundOrdinal + ".";
    render();
    startLoop();
  }

  async function loadSprites() {
    if (state.spritesReady) {
      return;
    }
    const sprites = config.sprites && typeof config.sprites === "object" ? config.sprites : {};
    const entries = Object.entries(sprites);
    if (entries.length === 0) {
      state.spritesReady = true;
      return;
    }

    await Promise.all(entries.map(([spriteId, source]) => loadSpriteImage(spriteId, source)));
    state.spritesReady = true;
  }

  function loadSpriteImage(spriteId, source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        state.spriteImages[spriteId] = image;
        resolve();
      };
      image.onerror = () => {
        reject(new Error("sprite_load_failed:" + spriteId));
      };
      image.src = String(source || "");
    });
  }

  function startLoop() {
    state.running = true;
    state.loopHandle = setInterval(() => {
      if (state.tickInFlight || !state.running) {
        return;
      }
      state.tickInFlight = true;
      void runTick().catch((error) => {
        state.running = false;
        setError("tick_failed: " + getErrorMessage(error));
      }).finally(() => {
        state.tickInFlight = false;
        render();
      });
    }, Number(config.tickMs) || 120);
  }

  async function runTick() {
    if (!state.flowState) {
      state.flowState = await getFlowState();
    }

    if (state.flowState.phase === "results") {
      await hydrateGlobalLeaderboard();
      state.playfieldMessage = "Results ready. Choose next action.";
      stopLoop();
      return;
    }

    if (shouldFinalizeFromElimination(state.flowState)) {
      await finalizeRoundIfNeeded();
      stopLoop();
      return;
    }

    const sync = toSync(state.flowState);
    const humanIntent = resolveDirectionalIntent(state.controls);
    const humanThrust = humanIntent.thrust;
    const botThrust = chooseBotThrust(findPlayer(state.flowState.players, state.botPlayerId), state.flowState.world.groundHeight);
    const botIntent = {
      thrust: botThrust,
      horizontal: chooseBotHorizontalIntent(state.flowState.world.tick, state.botPlayerId)
    };
    state.lastIntentByPlayer[state.humanPlayerId] = humanThrust;
    state.lastIntentByPlayer[state.botPlayerId] = botThrust;
    state.lastDirectionalIntentByPlayer[state.humanPlayerId] = humanIntent;
    state.lastDirectionalIntentByPlayer[state.botPlayerId] = botIntent;
    if (humanThrust >= 0.95) {
      state.hintAcknowledged.lift = true;
    }
    if (humanThrust <= -0.45) {
      state.hintAcknowledged.drop = true;
    }
    if (humanIntent.horizontal <= -0.9) {
      state.hintAcknowledged.left = true;
    }
    if (humanIntent.horizontal >= 0.9) {
      state.hintAcknowledged.right = true;
    }

    const humanInput = await postWithSync("/v1/rooms/" + state.roomId + "/input", {
      sequence: nextSequence(state.humanPlayerId),
      thrust: humanThrust,
      nowMs: Date.now(),
      sync
    }, state.authTokens[state.humanPlayerId]);

    const botInput = await postWithSync("/v1/rooms/" + state.roomId + "/input", {
      sequence: nextSequence(state.botPlayerId),
      thrust: botThrust,
      nowMs: Date.now(),
      sync: humanInput.sync || sync
    }, state.authTokens[state.botPlayerId]);

    await postWithSync("/v1/rooms/" + state.roomId + "/advance", {
      deltaMs: Number(config.tickMs) || 120,
      nowMs: Date.now(),
      sync: botInput.sync || humanInput.sync || sync
    });
    state.lastTickDeltaMs = Number(config.tickMs) || 120;

    state.flowState = await getFlowState();
    if (shouldComplete(state.flowState, Number(config.maxTicks) || 220)) {
      await finalizeRoundIfNeeded();
      state.playfieldMessage = "Game over. Review standings or replay.";
      stopLoop();
    }
  }

  async function finalizeRoundIfNeeded() {
    if (state.roundResult) {
      return;
    }

    if (!state.flowState) {
      state.flowState = await getFlowState();
    }

    const completeResponse = await postWithSync("/v1/rooms/" + state.roomId + "/complete", {
      recordedAt: Date.now(),
      sync: toSync(state.flowState)
    });
    state.roundResult = completeResponse;
    state.flowState = await getFlowState();
    await hydrateGlobalLeaderboard();
  }

  async function hydrateGlobalLeaderboard() {
    const leaderboardResponse = await requestJson("/api/global-leaderboard?limit=10", {
      method: "GET"
    });
    if (!leaderboardResponse.ok) {
      throw new Error("global leaderboard fetch failed");
    }
    state.globalLeaderboard = leaderboardResponse.body && leaderboardResponse.body.standings ? leaderboardResponse.body.standings : [];
  }

  function stopLoop() {
    state.running = false;
    if (state.loopHandle) {
      clearInterval(state.loopHandle);
      state.loopHandle = null;
    }
  }

  function nextSequence(playerId) {
    const next = (state.sequences[playerId] || 0) + 1;
    state.sequences[playerId] = next;
    return next;
  }

  async function createRoom() {
    const response = await requestJson(config.transportBaseUrl + "/v1/rooms", {
      method: "POST",
      body: {
        sessionId: state.roomId,
        nowMs: Date.now()
      }
    });
    if (response.ok || (response.status === 409 && response.body && response.body.error === "session_exists")) {
      return;
    }
    if (response.status === 409 && response.body && response.body.error === "session_already_exists") {
      return;
    }
    throw new Error("create_room_failed status=" + response.status);
  }

  async function joinPlayer(playerId, spawnHeight) {
    const response = await requestJson(config.transportBaseUrl + "/v1/rooms/" + state.roomId + "/players", {
      method: "POST",
      body: {
        playerId,
        nowMs: Date.now(),
        spawnHeight
      }
    });
    if (!response.ok) {
      throw new Error("join_failed player=" + playerId + " status=" + response.status);
    }
    return response.body.authToken;
  }

  async function getFlowState() {
    const response = await requestJson(config.transportBaseUrl + "/v1/rooms/" + state.roomId + "/flow-state", {
      method: "GET"
    });
    if (!response.ok) {
      throw new Error("flow_state_failed status=" + response.status);
    }
    return response.body;
  }

  async function postWithSync(path, body, authToken) {
    const url = path.startsWith("http") ? path : config.transportBaseUrl + path;
    const first = await requestJson(url, {
      method: "POST",
      authToken,
      body
    });

    if (first.status === 409 && first.body && first.body.error === "sync_mismatch" && first.body.resync && first.body.resync.flowState) {
      state.flowState = first.body.resync.flowState;
      const retryBody = Object.assign({}, body, {
        sync: toSync(first.body.resync.flowState)
      });
      const retry = await requestJson(url, {
        method: "POST",
        authToken,
        body: retryBody
      });
      if (!retry.ok) {
        throw new Error("sync_retry_failed status=" + retry.status + " path=" + path);
      }
      return retry.body;
    }

    if (!first.ok) {
      throw new Error("request_failed status=" + first.status + " path=" + path);
    }

    return first.body;
  }

  async function requestJson(url, options) {
    const headers = {};
    if (options.authToken) {
      headers.authorization = "Bearer " + options.authToken;
    }
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let body = null;
    if (text.length) {
      try {
        body = JSON.parse(text);
      } catch (_error) {
        body = text;
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  }

  function resolveDirectionalIntent(controlState) {
    if (controlState.touchMode === "up") {
      return { thrust: 1, horizontal: 0 };
    }
    if (controlState.touchMode === "down") {
      return { thrust: -0.5, horizontal: 0 };
    }
    if (controlState.touchMode === "left") {
      return { thrust: 0, horizontal: -1 };
    }
    if (controlState.touchMode === "right") {
      return { thrust: 0, horizontal: 1 };
    }
    if (controlState.touchMode === "neutral") {
      return { thrust: 0, horizontal: 0 };
    }

    const thrust = controlState.keyboardLiftActive === controlState.keyboardDropActive
      ? 0
      : controlState.keyboardLiftActive
        ? 1
        : -0.5;
    const horizontal = controlState.keyboardLeftActive === controlState.keyboardRightActive
      ? 0
      : controlState.keyboardLeftActive
        ? -1
        : 1;
    return { thrust, horizontal };
  }

  function chooseBotHorizontalIntent(tick, playerId) {
    const offset = String(playerId || "").length % 7;
    const wave = Math.sin((Number(tick || 0) + offset) * 0.12);
    if (wave > 0.25) {
      return 1;
    }
    if (wave < -0.25) {
      return -1;
    }
    return 0;
  }

  function resolveSpriteAnimation(input) {
    if (input.isEliminated) {
      return "dead";
    }
    if (!input.onPlatform) {
      if (input.verticalVelocity >= 0.12 || input.thrustIntent >= 0.2) {
        return "jump_up";
      }
      return "jump_down";
    }
    if (Math.abs(input.horizontalIntent) >= 0.24) {
      return "run";
    }
    return "idle";
  }

  function chooseBotThrust(player, groundHeight) {
    if (!player || !player.connected || player.isEliminated) {
      return 0;
    }
    const clearance = player.height - groundHeight;
    if (clearance <= 0.4 || player.velocity < -0.8) {
      return 1;
    }
    if (clearance >= 1.8 && player.velocity > 0.25) {
      return -0.2;
    }
    return 0.35;
  }

  function shouldComplete(flowState, maxTicks) {
    if (!flowState || !flowState.world) {
      return false;
    }
    if (flowState.world.tick >= maxTicks) {
      return true;
    }
    if (
      flowState.phase === "in_round" &&
      flowState.eliminationTransition &&
      (flowState.eliminationTransition.state === "ELIM-IMPACT" ||
        flowState.eliminationTransition.state === "ELIM-ACTIONS")
    ) {
      return false;
    }
    const players = Array.isArray(flowState.players) ? flowState.players : [];
    return players.length > 0 && players.every((player) => Boolean(player.isEliminated));
  }

  function shouldFinalizeFromElimination(flowState) {
    if (!flowState || flowState.phase !== "in_round" || !flowState.eliminationTransition) {
      return false;
    }
    const transition = flowState.eliminationTransition;
    return Boolean(
      transition.route &&
      transition.route.routeTarget === "results_screen" &&
      (transition.state === "ELIM-MANUAL-RESULTS" || transition.state === "ELIM-AUTO-RESULTS")
    );
  }

  function findPlayer(players, playerId) {
    if (!Array.isArray(players)) {
      return null;
    }
    return players.find((player) => player.playerId === playerId) || null;
  }

  function toSync(flowState) {
    return {
      revision: flowState.revision,
      tick: flowState.world.tick,
      stateHash: flowState.world.stateHash
    };
  }

  function setError(message) {
    state.errorMessage = message;
  }

  function clearError() {
    state.errorMessage = null;
  }

  function drawSpriteFrame(flow) {
    if (!(playfieldCanvas instanceof HTMLCanvasElement)) {
      return;
    }
    const ctx = playfieldCanvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const canvasWidth = playfieldCanvas.width || Number(config.playfield && config.playfield.width) || 960;
    const canvasHeight = playfieldCanvas.height || Number(config.playfield && config.playfield.height) || 360;
    const world = flow && flow.world ? flow.world : { tick: 0, groundHeight: 0, groundRiseSpeed: 0 };
    const players = flow && Array.isArray(flow.players) ? flow.players : [];
    const groundHeight = Number(world.groundHeight || 0);
    const maxPlayerHeight = players.reduce((maxHeight, player) => {
      return Math.max(maxHeight, Number(player.height || 0));
    }, groundHeight + 2.4);
    const cameraBottom = Math.max(0, groundHeight - 0.75);
    const cameraTop = Math.max(cameraBottom + 3.2, maxPlayerHeight + 1.2);
    const cameraRange = Math.max(0.001, cameraTop - cameraBottom);
    const toScreenY = (heightUnits) => {
      const normalized = (heightUnits - cameraBottom) / cameraRange;
      const clamped = Math.max(0, Math.min(1, normalized));
      return canvasHeight - (clamped * canvasHeight);
    };

    const speed = Number(world.groundRiseSpeed || 0);
    const tick = Number(world.tick || 0);
    const deltaMs = Number(state.lastTickDeltaMs || config.tickMs) || 120;
    const sky = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    sky.addColorStop(0, "#0a1228");
    sky.addColorStop(0.55, "#10234a");
    sky.addColorStop(1, "#1e293b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const hazardIntensity = Math.min(1, Math.max(0, (speed - 0.5) / 1.5));
    if (hazardIntensity > 0.05) {
      ctx.globalAlpha = 0.24 + (hazardIntensity * 0.36);
      tileSprite(ctx, state.spriteImages.hazardSky, 0, 0, canvasWidth, Math.max(36, canvasHeight * 0.42), 48, 24, tick * 2);
      ctx.globalAlpha = 1;
    }

    const groundY = Math.min(canvasHeight - 10, Math.max(28, toScreenY(groundHeight)));
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(0, groundY, canvasWidth, canvasHeight - groundY);
    tileSprite(ctx, state.spriteImages.hazardGround, 0, Math.max(groundY - 12, 0), canvasWidth, canvasHeight - groundY + 12, 48, 18, tick * 3);

    const platformSegments = buildPlatformSegments({
      canvasWidth,
      groundHeight,
      tick,
      toScreenY
    });
    platformSegments.forEach((segment) => {
      drawPlatformSegment(ctx, segment);
    });

    const sortedPlayers = [...players].sort((left, right) => String(left.playerId).localeCompare(String(right.playerId)));
    const laneWidth = canvasWidth / Math.max(sortedPlayers.length, 1);
    const globalMovementBounds = { min: 24, max: canvasWidth - 24 };
    sortedPlayers.forEach((player, index) => {
      const laneCenter = (laneWidth * index) + (laneWidth / 2);
      const playerY = toScreenY(Number(player.height || 0));
      const spriteKey = player.playerId === state.humanPlayerId ? "playerYou" : "playerBot";
      const sprite = state.spriteImages[spriteKey];
      const eliminated = Boolean(player.isEliminated);
      const directionalIntent = state.lastDirectionalIntentByPlayer[player.playerId] || {
        thrust: state.lastIntentByPlayer[player.playerId] || 0,
        horizontal: 0
      };
      const supportPlatform = resolveSupportingPlatform({
        platformSegments,
        playerFootY: playerY,
        velocity: Number(player.velocity || 0),
        eliminated
      });
      const movementBounds = supportPlatform
        ? {
          min: supportPlatform.left + 18,
          max: supportPlatform.right - 18
        }
        : globalMovementBounds;
      const renderState = ensurePlayerRenderState(state.playerRenderStateByPlayer, player.playerId, laneCenter);
      const movementSpeedPxPerSec = supportPlatform ? 165 : 112;
      renderState.x = clampNumber(
        renderState.x + (directionalIntent.horizontal * movementSpeedPxPerSec * (deltaMs / 1_000)),
        movementBounds.min,
        movementBounds.max,
      );
      if (Math.abs(directionalIntent.horizontal) > 0.2) {
        renderState.facing = directionalIntent.horizontal > 0 ? 1 : -1;
      }
      renderState.runPhase = (renderState.runPhase + (Math.abs(directionalIntent.horizontal) * deltaMs * 0.02)) % (Math.PI * 2);
      renderState.animation = resolveSpriteAnimation({
        isEliminated: eliminated,
        onPlatform: Boolean(supportPlatform),
        horizontalIntent: directionalIntent.horizontal,
        verticalVelocity: Number(player.velocity || 0),
        thrustIntent: directionalIntent.thrust
      });

      const spriteWidth = 48;
      const spriteHeight = 48;
      const runBob = renderState.animation === "run" ? Math.sin(renderState.runPhase) * 2 : 0;
      const jumpOffset =
        renderState.animation === "jump_up" ? -3 : renderState.animation === "jump_down" ? 2 : 0;
      const spriteCenterX = renderState.x;
      const spriteCenterY = playerY - (spriteHeight / 2) + runBob + jumpOffset;
      const spriteLeft = spriteCenterX - (spriteWidth / 2);
      const spriteTop = spriteCenterY - (spriteHeight / 2);

      drawPlayerSprite(ctx, {
        image: sprite,
        centerX: spriteCenterX,
        centerY: spriteCenterY,
        width: spriteWidth,
        height: spriteHeight,
        fallbackKey: spriteKey,
        animation: renderState.animation,
        facing: renderState.facing
      });

      if (!eliminated && directionalIntent.thrust > 0.35) {
        drawSpriteCentered(ctx, state.spriteImages.flame, spriteCenterX, playerY - 2, 24, 24, "flame");
      }

      if (eliminated) {
        ctx.strokeStyle = "rgba(248, 113, 113, 0.95)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(spriteLeft + 4, spriteTop + 6);
        ctx.lineTo(spriteLeft + spriteWidth - 4, spriteTop + spriteHeight - 6);
        ctx.moveTo(spriteLeft + spriteWidth - 4, spriteTop + 6);
        ctx.lineTo(spriteLeft + 4, spriteTop + spriteHeight - 6);
        ctx.stroke();
      }

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "600 12px Space Grotesk, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(player.playerId, spriteCenterX, Math.max(14, spriteTop - 8));
      if (player.playerId === state.humanPlayerId) {
        drawPlayerBadge(ctx, "YOU", spriteCenterX, Math.max(22, spriteTop - 22), "#164e63", "#67e8f9");
      }
      if (eliminated) {
        drawPlayerBadge(ctx, "OUT", spriteCenterX, Math.max(22, spriteTop - 36), "#7f1d1d", "#fecaca");
      }
    });

    ctx.strokeStyle = "rgba(251, 113, 133, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(canvasWidth, groundY);
    ctx.stroke();

    if (flow && flow.phase === "in_round") {
      const humanRenderState = state.playerRenderStateByPlayer[state.humanPlayerId];
      const motionCopy = humanRenderState
        ? " | x " + Math.round(humanRenderState.x) + " | anim " + humanRenderState.animation
        : "";
      state.playfieldMessage =
        "Tick " + tick + " | ground " + groundHeight.toFixed(2) + " | speed x" + (speed / 0.5).toFixed(2) + motionCopy;
    } else if (flow && flow.phase === "results") {
      state.playfieldMessage = "Game over. Replay Match to restart.";
    }

    if (playfieldOverlay) {
      playfieldOverlay.textContent = state.playfieldMessage;
    }
  }

  function buildPlatformSegments(input) {
    const levels = [0.95, 1.75, 2.55];
    const widths = [0.46, 0.36, 0.29];
    return levels.map((offset, index) => {
      const width = input.canvasWidth * widths[index];
      const sway = Math.sin((input.tick * 0.08) + (index * 0.9)) * 42;
      const anchor = input.canvasWidth * (0.5 + ((index - 1) * 0.2));
      const center = clampNumber(anchor + sway, width / 2 + 16, input.canvasWidth - width / 2 - 16);
      const left = center - (width / 2);
      const right = center + (width / 2);
      return {
        id: "platform-" + index,
        left,
        right,
        y: input.toScreenY(input.groundHeight + offset),
        width
      };
    });
  }

  function drawPlatformSegment(ctx, segment) {
    const thickness = 10;
    ctx.fillStyle = "rgba(71, 85, 105, 0.94)";
    ctx.fillRect(segment.left, segment.y - (thickness / 2), segment.width, thickness);
    ctx.fillStyle = "rgba(148, 163, 184, 0.55)";
    ctx.fillRect(segment.left, segment.y - (thickness / 2), segment.width, 2);
  }

  function resolveSupportingPlatform(input) {
    if (input.eliminated) {
      return null;
    }
    return input.platformSegments.find((segment) => {
      const verticalGap = Math.abs(input.playerFootY - segment.y);
      return verticalGap <= 11 && input.velocity <= 0.35;
    }) || null;
  }

  function ensurePlayerRenderState(byPlayerId, playerId, fallbackX) {
    const existing = byPlayerId[playerId];
    if (existing) {
      return existing;
    }
    const created = {
      x: fallbackX,
      facing: 1,
      runPhase: 0,
      animation: "idle"
    };
    byPlayerId[playerId] = created;
    return created;
  }

  function drawPlayerSprite(ctx, input) {
    ctx.save();
    ctx.translate(input.centerX, input.centerY);
    if (input.facing < 0) {
      ctx.scale(-1, 1);
    }
    if (input.animation === "jump_up") {
      ctx.rotate(-0.16);
    } else if (input.animation === "jump_down") {
      ctx.rotate(0.12);
      ctx.scale(1.06, 0.92);
    } else if (input.animation === "run") {
      ctx.scale(1.04, 0.98);
    }

    if (input.image) {
      ctx.drawImage(input.image, -(input.width / 2), -(input.height / 2), input.width, input.height);
    } else {
      ctx.fillStyle = input.fallbackKey === "playerBot" ? "#fb923c" : "#22d3ee";
      ctx.fillRect(-(input.width / 2), -(input.height / 2), input.width, input.height);
    }
    ctx.restore();
  }

  function drawPlayerBadge(ctx, label, centerX, centerY, fill, stroke) {
    const width = 30;
    const height = 14;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(centerX - (width / 2), centerY - (height / 2), width, height, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "700 9px Space Grotesk, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, centerX, centerY + 3);
    ctx.restore();
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function tileSprite(ctx, image, x, y, width, height, tileWidth, tileHeight, offsetX) {
    if (!image) {
      ctx.fillStyle = "rgba(249, 115, 22, 0.2)";
      ctx.fillRect(x, y, width, height);
      return;
    }
    const startX = x - (Math.abs(offsetX || 0) % tileWidth);
    for (let drawY = y; drawY < y + height; drawY += tileHeight) {
      for (let drawX = startX; drawX < x + width + tileWidth; drawX += tileWidth) {
        ctx.drawImage(image, drawX, drawY, tileWidth, tileHeight);
      }
    }
  }

  function drawSpriteCentered(ctx, image, centerX, centerY, width, height, fallbackKey) {
    const left = centerX - (width / 2);
    const top = centerY - (height / 2);
    if (image) {
      ctx.drawImage(image, left, top, width, height);
      return;
    }
    ctx.fillStyle = fallbackKey === "playerBot" ? "#fb923c" : "#22d3ee";
    if (fallbackKey === "flame") {
      ctx.fillStyle = "#f97316";
    }
    ctx.fillRect(left, top, width, height);
  }

  function render() {
    applySurfaceMode();
    const flow = state.flowState;
    const tick = flow && flow.world ? flow.world.tick : 0;
    const phase = flow && flow.phase ? flow.phase : "waiting";
    const groundHeight = flow && flow.world ? Number(flow.world.groundHeight || 0).toFixed(2) : "0.00";
    const speed = flow && flow.world ? Number((flow.world.groundRiseSpeed || 0) / 0.5).toFixed(2) : "0.00";

    statusLine.textContent = "Room " + state.roomId + " tick " + tick + " ground " + groundHeight + " speed x" + speed;
    phaseLine.textContent = "Phase: " + phase;
    surfaceChip.textContent = "Surface: " + state.surfacePreference + " -> " + state.resolvedSurface;
    loopChip.textContent = state.running ? "Loop: running" : "Loop: stopped";
    loopChip.classList.toggle("is-live", state.running);

    if (state.errorMessage) {
      errorBox.textContent = state.errorMessage;
      errorBox.className = "alert error";
      loopChip.classList.add("is-error");
    } else {
      errorBox.textContent = "No transport errors.";
      errorBox.className = "alert";
      loopChip.classList.remove("is-error");
    }

    const rising = flow && flow.uxState && flow.uxState.risingGround ? flow.uxState.risingGround : null;
    const recoveredTransition = flow && flow.resultsLifecycle ? flow.resultsLifecycle.recoveredTransition : null;
    if (recoveredTransition && recoveredTransition.stateId === "TS-SERVICE-RECOVERED") {
      risingCopy.textContent = "Leaderboard synced. Your placement is now confirmed.";
      risingCopy.className = "alert";
    } else {
      risingCopy.textContent = rising && rising.copy ? rising.copy : "Waiting for rising-ground telemetry...";
      risingCopy.className = "alert warn";
    }

    drawSpriteFrame(flow);
    renderObjectiveRibbon(flow);
    renderControlHintDock(flow);
    renderHud(flow);
    renderLiveRows(flow);
    renderFinalRows(flow);
    renderGlobalRows();
    renderElimination(flow);
    renderResultsPanel(flow);
  }

  function renderObjectiveRibbon(flow) {
    if (!objectiveRibbon || !objectiveIcon || !objectiveCopy || !objectiveProgress) {
      return;
    }

    const uxId = flow && flow.uxState ? flow.uxState.id : null;
    const liftDone = state.hintAcknowledged.lift;
    const dropDone = state.hintAcknowledged.drop;
    const bothDone = liftDone && dropDone;

    let icon = "▲";
    let copy = "Objective: Stay above hazard and clear first checkpoint.";
    let progress = bothDone ? "Live" : liftDone || dropDone ? "Step 2/2" : "Step 1/2";

    if (uxId === "PM-LOBBY-STATUS") {
      icon = "◉";
      copy = "Objective: Confirm readiness before countdown starts.";
      progress = "Step 1/2";
    } else if (uxId === "PM-COUNTDOWN") {
      icon = "⏱";
      copy = "Objective: Launch on GO and keep lane control through first hazard spike.";
    } else if (uxId === "HUD-ELIMINATED") {
      icon = "✕";
      copy = "Objective failed. Follow elimination guidance to recover route choice.";
      progress = "Review";
    } else if (flow && flow.phase === "results") {
      icon = "✓";
      copy = "Objective complete. Review placement movement and decide next route.";
      progress = "Live";
    }

    objectiveRibbon.hidden = false;
    objectiveIcon.textContent = icon;
    objectiveCopy.textContent = copy;
    objectiveProgress.textContent = progress;
  }

  function renderControlHintDock(flow) {
    if (!controlHintDock || !hintLift || !hintDrop || !hintLeft || !hintRight) {
      return;
    }

    if (!flow || flow.phase === "results") {
      controlHintDock.hidden = true;
      return;
    }

    controlHintDock.hidden = false;
    const liftPrefix = state.resolvedSurface === "mobile" ? "Tap up" : "W / Space";
    const dropPrefix = state.resolvedSurface === "mobile" ? "Tap down" : "S / ArrowDown";
    const leftPrefix = state.resolvedSurface === "mobile" ? "Hold left" : "A / ArrowLeft";
    const rightPrefix = state.resolvedSurface === "mobile" ? "Hold right" : "D / ArrowRight";

    hintLift.textContent = state.hintAcknowledged.lift
      ? "Lift cue complete"
      : liftPrefix + " once to clear first lane";
    hintDrop.textContent = state.hintAcknowledged.drop
      ? "Drop cue complete"
      : dropPrefix + " to stabilize before hazard crest";
    hintLeft.textContent = state.hintAcknowledged.left
      ? "Left bound verified"
      : leftPrefix + " to test platform edge bounds";
    hintRight.textContent = state.hintAcknowledged.right
      ? "Run cue complete"
      : rightPrefix + " to trigger run cycle";

    hintLift.classList.toggle("is-cleared", state.hintAcknowledged.lift);
    hintDrop.classList.toggle("is-cleared", state.hintAcknowledged.drop);
    hintLeft.classList.toggle("is-cleared", state.hintAcknowledged.left);
    hintRight.classList.toggle("is-cleared", state.hintAcknowledged.right);
  }

  function renderHud(flow) {
    const hud = flow && flow.hud && flow.hud.byPlayerId ? flow.hud.byPlayerId[state.humanPlayerId] : null;
    hudRank.textContent = hud && hud.rank ? String(hud.rank.value) : "--";
    hudScore.textContent = hud && hud.score ? String(hud.score.value) : "--";
    hudSurvival.textContent = hud && hud.survivalTime ? String(hud.survivalTime.value) : "--";
    hudGroundSpeed.textContent = hud && hud.groundSpeed ? String(hud.groundSpeed.value) : "--";
    hudPlayersLeft.textContent = hud && hud.playersLeft ? String(hud.playersLeft.value) : "--";
  }

  function renderLiveRows(flow) {
    const rows = flow ? buildLiveRows(flow) : [];
    liveStandings.innerHTML = rows.map((row) => {
      return "<tr><td>" + row.rank + "</td><td>" + escapeHtml(row.playerId) + "</td><td>" + row.score + "</td><td>" + row.height + "</td><td class=\"muted\">" + row.status + "</td></tr>";
    }).join("");
  }

  function renderFinalRows(flow) {
    const flowStandings = flow && flow.phase === "results" && Array.isArray(flow.standings) ? flow.standings : [];
    const resultStandings = state.roundResult && Array.isArray(state.roundResult.standings) ? state.roundResult.standings : [];
    const flowCommits = flow && flow.phase === "results" && Array.isArray(flow.commits) ? flow.commits : [];
    const resultCommits = state.roundResult && Array.isArray(state.roundResult.commits) ? state.roundResult.commits : [];
    const standings = resultStandings.length ? resultStandings : flowStandings;
    const commits = resultCommits.length ? resultCommits : flowCommits;
    const commitByPlayerId = new Map(commits.map((entry) => [entry.playerId, entry]));

    finalStandings.innerHTML = standings.map((row) => {
      const commit = commitByPlayerId.get(row.playerId) || null;
      const prevRank = commit && commit.previousRank ? "#" + commit.previousRank : "—";
      const nowRank = commit && commit.rank ? "#" + commit.rank : "#" + row.rank;
      const rankDelta = commit && typeof commit.rankDelta === "number" ? commit.rankDelta : null;
      const deltaText = rankDelta === null ? "—" : rankDelta > 0 ? "+" + rankDelta : String(rankDelta);
      const deltaClass = rankDelta === null ? "muted" : rankDelta > 0 ? "delta-pos" : rankDelta < 0 ? "delta-neg" : "muted";
      const tieCopy = row.placementToken && String(row.placementToken).startsWith("T-") ? "Tied at #" + row.rank : "";
      return "<tr><td>" + escapeHtml(row.playerId) + "</td><td>" + row.score + "</td><td>" + prevRank + "</td><td>" + nowRank + "</td><td class=\"" + deltaClass + "\">" + deltaText + "</td><td class=\"muted\">" + escapeHtml(tieCopy) + "</td></tr>";
    }).join("");
  }

  function renderGlobalRows() {
    const standings = Array.isArray(state.globalLeaderboard) ? state.globalLeaderboard : [];
    globalStandings.innerHTML = standings.map((row) => {
      const updated = row.updatedAt ? new Date(row.updatedAt).toISOString() : "";
      return "<tr><td>" + row.rank + "</td><td>" + escapeHtml(row.playerId) + "</td><td>" + row.score + "</td><td class=\"muted\">" + updated + "</td></tr>";
    }).join("");
  }

  function renderElimination(flow) {
    const transition = flow && flow.phase === "in_round" ? flow.eliminationTransition : null;
    if (!transition) {
      eliminationPanel.hidden = true;
      eliminationActions.innerHTML = "";
      eliminationOutcome.textContent = "";
      eliminationCause.textContent = "Cause: waiting";
      eliminationCountdown.textContent = "Respawn: --";
      eliminationNextAction.textContent = "Next action: --";
      return;
    }

    eliminationPanel.hidden = false;
    eliminationHeadline.textContent = transition.headlineCopy || "Eliminated";
    eliminationHelper.textContent = transition.helperCopy || "You can spectate now or view results.";
    eliminationCause.textContent = "Cause: " + resolveEliminationCause(transition.eliminationCause);
    eliminationCountdown.textContent = "Respawn: " + resolveEliminationCountdown(transition);
    eliminationNextAction.textContent = "Next action: " + resolveEliminationNextAction(transition);
    eliminationState.textContent = "State: " + transition.state;

    if (transition.route) {
      eliminationOutcome.textContent = "Route: " + transition.route.actionId + " -> " + transition.route.routeTarget;
    } else {
      eliminationOutcome.textContent = "";
    }

    const showActions = transition.state === "ELIM-ACTIONS" && !transition.route;
    if (!showActions) {
      eliminationActions.innerHTML = "";
      return;
    }

    eliminationActions.innerHTML = transition.actionCtas.map((cta) => {
      const tone = cta.style === "primary" ? " primary" : "";
      return "<button type=\"button\" class=\"action-btn" + tone + "\" data-elim-action=\"" + escapeHtml(cta.id) + "\" " +
        (state.actionRequestInFlight ? "disabled" : "") +
        ">" + escapeHtml(cta.label) + "</button>";
    }).join("");
  }

  function renderResultsPanel(flow) {
    if (!flow || flow.phase !== "results") {
      resultsPanel.hidden = true;
      resultsActions.innerHTML = "";
      resultsOutcome.textContent = "";
      resultsAck.hidden = true;
      return;
    }

    resultsPanel.hidden = false;
    finalPlacement.textContent = "Final Placement: " + resolveFinalPlacement(flow);
    resultsStatus.textContent = resolveResultsStatus(flow.resultsLifecycle);

    const blockedGuidance =
      state.postMatchAttempt &&
      state.postMatchAttempt.blocked &&
      state.postMatchAttempt.guidanceCopy
        ? state.postMatchAttempt.guidanceCopy
        : null;
    resultsGuidance.textContent = blockedGuidance || flow.postMatchActions.guidanceCopy;

    resultsAck.hidden = flow.resultsLifecycle.state !== "RESULTS-FAILED" || flow.resultsLifecycle.acknowledged;
    resultsAck.disabled = state.actionRequestInFlight;

    resultsActions.innerHTML = flow.postMatchActions.available.map((action) => {
      const tone = action.style === "primary" ? " primary" : "";
      const label = action.id === "REPLAY_MATCH" ? "Play Again (Replay Match)" : action.label;
      const disabled = !flow.resultsLifecycle.rematchEnabled || state.actionRequestInFlight;
      return "<button type=\"button\" class=\"action-btn" + tone + "\" data-results-action=\"" + escapeHtml(action.id) + "\" " +
        (disabled ? "disabled" : "") +
        ">" + escapeHtml(label) + "</button>";
    }).join("");

    if (state.postMatchAttempt && state.postMatchAttempt.outcomeCopy) {
      resultsOutcome.textContent = state.postMatchAttempt.outcomeCopy;
    } else if (flow.postMatchActions.selected && flow.postMatchActions.selected.outcomeCopy) {
      resultsOutcome.textContent = flow.postMatchActions.selected.outcomeCopy;
    } else {
      resultsOutcome.textContent = "";
    }
  }

  function resolveEliminationCause(cause) {
    if (cause === "disconnected") {
      return "Disconnected";
    }
    if (cause === "ground") {
      return "Missed safe lane";
    }
    return "Unknown";
  }

  function resolveEliminationCountdown(transition) {
    if (transition.state === "ELIM-IMPACT") {
      return (Math.ceil(Number(transition.impactDurationMs || 0) / 100) / 10).toFixed(1) + "s";
    }
    if (transition.state === "ELIM-ACTIONS") {
      return (Math.ceil(Number(transition.actionsTimeoutMs || 0) / 100) / 10).toFixed(1) + "s";
    }
    return "Routed";
  }

  function resolveEliminationNextAction(transition) {
    if (transition.route && transition.route.routeTarget) {
      return "Route to " + transition.route.routeTarget;
    }
    if (Array.isArray(transition.actionCtas) && transition.actionCtas.length > 0) {
      return transition.actionCtas[0].label;
    }
    return "View results";
  }

  function resolveFinalPlacement(flow) {
    const standings = Array.isArray(flow.standings) ? flow.standings : [];
    const playerEntry = standings.find((entry) => entry.playerId === state.humanPlayerId);
    if (!playerEntry) {
      return "--";
    }
    return playerEntry.placementToken ? playerEntry.placementToken : "#" + playerEntry.rank;
  }

  function resolveResultsStatus(resultsLifecycle) {
    if (!resultsLifecycle) {
      return "Waiting for results lifecycle...";
    }

    if (resultsLifecycle.state === "RESULTS-PENDING") {
      return "Saving your match result...";
    }
    if (resultsLifecycle.state === "RESULTS-RETRYING") {
      if (resultsLifecycle.delayedVariant) {
        return "Still syncing leaderboard. Your result is safe and will appear soon.";
      }
      const attempt = resultsLifecycle.attempt || 1;
      const maxAttempts = resultsLifecycle.maxAttempts || attempt;
      return "Sync issue detected. Retrying leaderboard save (" + attempt + "/" + maxAttempts + ")...";
    }
    if (resultsLifecycle.state === "RESULTS-FAILED") {
      return "Leaderboard sync failed for now. We will keep retrying in the background.";
    }
    return "Match complete. Final standings are in";
  }

  function buildLiveRows(flow) {
    const players = Array.isArray(flow.players) ? flow.players : [];
    const byPlayerId = flow.hud && flow.hud.byPlayerId ? flow.hud.byPlayerId : {};
    const mapped = players.map((player) => {
      const hud = byPlayerId[player.playerId] || {};
      const score = hud.score && typeof hud.score.value === "number" ? hud.score.value : 0;
      return {
        playerId: player.playerId,
        score,
        height: Number(player.height || 0).toFixed(2),
        eliminated: Boolean(player.isEliminated)
      };
    });

    mapped.sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      return String(left.playerId).localeCompare(String(right.playerId));
    });

    return mapped.map((entry, index) => ({
      rank: index + 1,
      playerId: entry.playerId,
      score: entry.score,
      height: entry.height,
      status: entry.eliminated ? "ELIM" : "LIVE"
    }));
  }

  function bindEliminationActions() {
    eliminationActions.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest("[data-elim-action]");
      if (!button) {
        return;
      }
      const actionId = button.getAttribute("data-elim-action");
      if (!actionId || state.actionRequestInFlight) {
        return;
      }

      void submitEliminationAction(actionId);
    });
  }

  function bindResultsActions() {
    resultsActions.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest("[data-results-action]");
      if (!button) {
        return;
      }
      const actionId = button.getAttribute("data-results-action");
      if (!actionId || state.actionRequestInFlight) {
        return;
      }

      void submitPostMatchAction(actionId);
    });

    resultsAck.addEventListener("click", () => {
      if (state.actionRequestInFlight) {
        return;
      }
      void acknowledgeResultsFailure();
    });
  }

  async function submitEliminationAction(actionId) {
    state.actionRequestInFlight = true;
    try {
      const response = await requestJson("/api/rooms/" + state.roomId + "/elimination/action", {
        method: "POST",
        body: {
          actionId,
          nowMs: Date.now()
        }
      });
      if (!response.ok) {
        throw new Error("elimination_action_failed status=" + response.status);
      }
      state.eliminationSelection = response.body;
      state.flowState = await getFlowState();
      if (shouldFinalizeFromElimination(state.flowState)) {
        await finalizeRoundIfNeeded();
        stopLoop();
      }
      clearError();
    } catch (error) {
      setError("elimination_action_failed: " + getErrorMessage(error));
    } finally {
      state.actionRequestInFlight = false;
      render();
    }
  }

  async function submitPostMatchAction(actionId) {
    state.actionRequestInFlight = true;
    try {
      const response = await requestJson("/api/rooms/" + state.roomId + "/post-match/action", {
        method: "POST",
        body: {
          actionId,
          nowMs: Date.now()
        }
      });
      if (!response.ok) {
        throw new Error("post_match_action_failed status=" + response.status);
      }
      state.postMatchAttempt = response.body;

      if (response.body && response.body.actionId === "REPLAY_MATCH" && !response.body.blocked) {
        await replayRound();
        clearError();
        return;
      }

      state.flowState = await getFlowState();
      if (response.body && response.body.routeTarget) {
        state.playfieldMessage = "Route selected: " + response.body.routeTarget;
      }
      clearError();
    } catch (error) {
      setError("post_match_action_failed: " + getErrorMessage(error));
    } finally {
      state.actionRequestInFlight = false;
      render();
    }
  }

  async function replayRound() {
    stopLoop();
    state.roundOrdinal += 1;
    state.roomId = allocateRoomId(config.roomId);
    state.flowState = null;
    state.roundResult = null;
    state.postMatchAttempt = null;
    state.eliminationSelection = null;
    state.globalLeaderboard = [];
    state.authTokens = {};
    state.sequences = {};
    state.lastIntentByPlayer = {};
    state.lastDirectionalIntentByPlayer = {};
    state.playerRenderStateByPlayer = {};
    state.hintAcknowledged.lift = false;
    state.hintAcknowledged.drop = false;
    state.hintAcknowledged.left = false;
    state.hintAcknowledged.right = false;
    state.playfieldMessage = "Replay started. Building new round.";
    statusLine.textContent = "Replay started. Creating room " + state.roomId + "...";

    await createRoom();
    state.authTokens[state.humanPlayerId] = await joinPlayer(state.humanPlayerId, 4.8);
    state.authTokens[state.botPlayerId] = await joinPlayer(state.botPlayerId, 5.0);
    state.sequences[state.humanPlayerId] = 0;
    state.sequences[state.botPlayerId] = 0;
    state.lastIntentByPlayer[state.humanPlayerId] = 0;
    state.lastIntentByPlayer[state.botPlayerId] = 0;
    state.lastDirectionalIntentByPlayer[state.humanPlayerId] = { thrust: 0, horizontal: 0 };
    state.lastDirectionalIntentByPlayer[state.botPlayerId] = { thrust: 0, horizontal: 0 };
    state.flowState = await getFlowState();
    state.playfieldMessage = "Round " + state.roundOrdinal + " live.";
    statusLine.textContent = "Room live. Loop active. Round " + state.roundOrdinal + ".";
    startLoop();
  }

  async function acknowledgeResultsFailure() {
    state.actionRequestInFlight = true;
    try {
      const response = await requestJson("/api/rooms/" + state.roomId + "/results/ack", {
        method: "POST",
        body: {
          nowMs: Date.now()
        }
      });
      if (!response.ok) {
        throw new Error("results_ack_failed status=" + response.status);
      }
      state.flowState = await getFlowState();
      clearError();
    } catch (error) {
      setError("results_ack_failed: " + getErrorMessage(error));
    } finally {
      state.actionRequestInFlight = false;
      render();
    }
  }

  function bindSurfaceButtons() {
    surfaceButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.surfacePreference = button.getAttribute("data-surface-pref") || "auto";
        surfaceButtons.forEach((nextButton) => {
          nextButton.setAttribute("aria-pressed", nextButton === button ? "true" : "false");
        });
        applySurfaceMode();
        render();
      });
    });
  }

  function bindKeyboardControls() {
    const LIFT_KEYS = new Set([" ", "w", "W", "ArrowUp"]);
    const DROP_KEYS = new Set(["s", "S", "ArrowDown"]);
    const LEFT_KEYS = new Set(["a", "A", "ArrowLeft"]);
    const RIGHT_KEYS = new Set(["d", "D", "ArrowRight"]);

    window.addEventListener("keydown", (event) => {
      const handled = LIFT_KEYS.has(event.key) || DROP_KEYS.has(event.key) || LEFT_KEYS.has(event.key) || RIGHT_KEYS.has(event.key);
      if (handled) {
        event.preventDefault();
      }
      if (LIFT_KEYS.has(event.key)) {
        state.controls.keyboardLiftActive = true;
        clearError();
      }
      if (DROP_KEYS.has(event.key)) {
        state.controls.keyboardDropActive = true;
        clearError();
      }
      if (LEFT_KEYS.has(event.key)) {
        state.controls.keyboardLeftActive = true;
        clearError();
      }
      if (RIGHT_KEYS.has(event.key)) {
        state.controls.keyboardRightActive = true;
        clearError();
      }
    });

    window.addEventListener("keyup", (event) => {
      const handled = LIFT_KEYS.has(event.key) || DROP_KEYS.has(event.key) || LEFT_KEYS.has(event.key) || RIGHT_KEYS.has(event.key);
      if (handled) {
        event.preventDefault();
      }
      if (LIFT_KEYS.has(event.key)) {
        state.controls.keyboardLiftActive = false;
      }
      if (DROP_KEYS.has(event.key)) {
        state.controls.keyboardDropActive = false;
      }
      if (LEFT_KEYS.has(event.key)) {
        state.controls.keyboardLeftActive = false;
      }
      if (RIGHT_KEYS.has(event.key)) {
        state.controls.keyboardRightActive = false;
      }
    });
  }

  function bindTouchControls() {
    touchButtons.forEach((button) => {
      const mode = button.getAttribute("data-control") || "none";
      const activate = (event) => {
        event.preventDefault();
        state.controls.touchMode = mode;
        touchButtons.forEach((nextButton) => {
          nextButton.classList.toggle("is-active", nextButton === button);
        });
      };

      const deactivate = (event) => {
        event.preventDefault();
        if (state.controls.touchMode === mode) {
          state.controls.touchMode = "none";
          button.classList.remove("is-active");
        }
      };

      button.addEventListener("pointerdown", activate);
      button.addEventListener("pointerup", deactivate);
      button.addEventListener("pointercancel", deactivate);
      button.addEventListener("pointerleave", deactivate);
    });
  }

  function applySurfaceMode() {
    const probe = {
      viewportWidth: window.innerWidth || 1280,
      coarsePointer: Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)
    };
    state.resolvedSurface = resolveSurface(state.surfacePreference, probe);
    document.body.setAttribute("data-surface", state.resolvedSurface);
  }

  function resolveSurface(preference, probe) {
    if (preference === "desktop" || preference === "mobile") {
      return preference;
    }
    if (probe.coarsePointer || probe.viewportWidth <= 920) {
      return "mobile";
    }
    return "desktop";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getErrorMessage(error) {
    if (error && typeof error.message === "string") {
      return error.message;
    }
    return String(error);
  }
})();`;
