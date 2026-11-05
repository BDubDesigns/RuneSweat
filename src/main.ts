/**
 * Lara's Pose Games — hub bootstrap.
 *
 * The hub owns: the camera, the pose source, the fixed-timestep loop, the
 * video/avatar rendering, and the DOM. A game owns only its own simulation
 * + canvas drawing + HUD string (see src/games/game.ts).
 *
 * Flow: pick a game -> turn the camera on (or play without a camera) ->
 * play. The mouse simulator is offered automatically if the camera is
 * denied or unavailable, so the games are always playable.
 *
 * The camera video is NEVER shown during normal play (the player sees the
 * game + their avatar only); the "Show camera" toggle is for calibration
 * only. A game does not start — and pauses mid-game — while the
 * body-visible gate is closed (no usable full-body pose, or the pose model
 * failed to load). See `src/core/gate.ts`.
 *
 * Mirroring: in code only, in `toCanvas()` / `drawVideoMirrored()`. The
 * canvas is never flipped with CSS.
 */

import './styles.css';

import replayFixture from '../fixtures/replay-sweep.json';
import { GAMES, GATE, LOOP, OUTFIT, SOURCE_SELECTION, STAGE } from './core/config';
import { startCamera, stopCamera, CameraError } from './core/camera';
import { SoundEffects } from './core/audio';
import { BodyStateTracker, type BodyState } from './core/bodyState';
import { evaluateGate, type GateOptions, type GateState, type ModelState } from './core/gate';
import { createFixedStepLoop } from './core/loop';
import { drawHud, type HudReadout } from './debug/hud';
import { syncCanvasBackingStore, toNormalized, type Vec2 } from './render/stage';
import { AvatarRenderer } from './render/avatar';
import {
  drawBlockingOverlay,
  drawSkeleton,
  drawStageBackground,
  drawVideoMirrored,
} from './render/renderer';
import { MediaPipePoseSource, defaultMediaPipeOptions } from './tracking/mediapipeSource';
import type {
  NormalizedLandmark,
  PoseFrameSource,
} from './tracking/poseTypes';
import { MouseSource } from './sim/mouseSource';
import { parseReplayClip, ReplaySource } from './sim/replaySource';
import type { Game, GameConstructor } from './games/game';
import { SpaceInvadersGame } from './games/space-invaders/spaceInvaders';
import { DanceDropGame } from './games/dance-drop/danceDrop';
import { SwingLabGame } from './games/swing-lab/swingLab';

const GAME_CONSTRUCTORS: Record<string, GameConstructor> = {
  'space-invaders': SpaceInvadersGame,
  'dance-drop': DanceDropGame,
  'swing-lab': SwingLabGame,
};

const GAME_BLURBS: Record<string, string> = {
  'space-invaders':
    '🚀 Move your body to fly the ship. Raise an arm to shoot!',
  'dance-drop': '💃 Copy the falling pose before it lands in your zone!',
  'swing-lab': '⛏️ Raise both arms overhead, then chop down to mine Ferrite Shale at The Jag!',
  'auto-runner': '🏃 Switch lanes, jump and duck! Coming soon.',
  lumberjack: '🪓 Chop trees with your body. Coming soon.',
};

function requireElement<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`pose-arcade: #${id} is missing from index.html`);
  }
  return el;
}

/**
 * Pause kinds (Swing Lab v3.1, Nov 4, 2026). Two ways a game can be
 * paused, and they must not be confused:
 *
 * - `manual`: the player pressed Spacebar or the Pause button. Opens
 *   the town-hub overlay and STAYS paused until Spacebar / Pause is
 *   pressed again — coming back into frame must NOT resume it.
 * - `auto`: the body-visible gate closed (body left frame). Resumes
 *   automatically when the body returns. NEVER opens the hub.
 * - `none`: playing.
 *
 * The old `pausedByGate` boolean could not tell these apart, so a
 * manual pause was silently resumed by the gate and the Pause button
 * went inert while gated.
 */
export type PauseKind = 'none' | 'manual' | 'auto';

/**
 * Town-hub overlay plug (Worker B, `src/hub/`): the hub opens when the
 * player pauses manually and closes when they resume. main.ts calls
 * these; it never draws the hub itself. Register with
 * `registerHubOverlay`; until one is registered the canvas fallback in
 * main.ts ("Paused — press Space to resume") is the manual-pause
 * surface, and it stands down the moment a hub registers.
 */
export interface HubOverlay {
  /** Show the town-hub overlay. Called only for a manual pause, never auto. */
  open(): void;
  /** Hide the town-hub overlay. */
  close(): void;
}

/** The town-hub overlay currently registered by `src/hub/`, if any. */
let hubOverlay: HubOverlay | null = null;

/**
 * Register (or unregister with `null`) the town-hub overlay. Called by
 * Worker B's hub module at integration; main.ts never imports the hub,
 * so there is no import cycle — the hub imports this function.
 */
export function registerHubOverlay(hub: HubOverlay | null): void {
  hubOverlay = hub;
}

/**
 * Events the pause state machine raises. main.ts wires them to the game,
 * the Pause button label, and the hub overlay.
 */
export interface PauseEvents {
  /** A manual pause started: the game must pause and the hub must open. */
  onManualPause(): void;
  /** A manual pause ended: the hub must close and the game must resume. */
  onManualResume(): void;
  /** The gate paused the game (body left frame): pause, no hub. */
  onAutoPause(): void;
  /** The gate reopened: resume. Never fires while a manual pause holds. */
  onAutoResume(): void;
}

/**
 * The pause state machine (pure — no DOM, no game; unit-tested in
 * `src/main.test.ts`). Transition table:
 *
 * | from   | event            | to       | side effect                  |
 * |--------|------------------|----------|------------------------------|
 * | none   | toggleManual     | manual   | onManualPause (hub opens)  |
 * | manual | toggleManual     | none     | onManualResume (hub closes)|
 * | auto   | toggleManual     | manual   | onManualPause (CONVERTS:   |
 * |        |                  |          | the press is honoured, the |
 * |        |                  |          | game stays paused, hub     |
 * |        |                  |          | opens; stepping back into  |
 * |        |                  |          | frame no longer resumes)   |
 * | none   | gateClosed       | auto     | onAutoPause (no hub)       |
 * | manual | gateClosed       | manual   | nothing (gate must not     |
 * |        |                  |          | touch a manual pause)      |
 * | auto   | gateClosed       | auto     | nothing                    |
 * | auto   | gateOpened       | none     | onAutoResume               |
 * | manual | gateOpened       | manual   | nothing (body returning    |
 * |        |                  |          | must NOT resume it)        |
 * | none   | gateOpened       | none     | nothing                    |
 * | any    | reset            | none     | the matching resume event  |
 * |        |                  |          | (manual -> onManualResume, |
 * |        |                  |          | auto -> onAutoResume)      |
 */
export class PauseController {
  public kind: PauseKind = 'none';

  public constructor(private readonly events: PauseEvents) {}

  /** Spacebar / Pause button. */
  public toggleManual(): void {
    if (this.kind === 'manual') {
      this.kind = 'none';
      this.events.onManualResume();
    } else {
      this.kind = 'manual';
      this.events.onManualPause();
    }
  }

  /** The body-visible gate closed (body left frame). */
  public gateClosed(): void {
    if (this.kind === 'none') {
      this.kind = 'auto';
      this.events.onAutoPause();
    }
    // 'manual' stays manual; 'auto' stays auto.
  }

  /** The body-visible gate opened (body back in frame). */
  public gateOpened(): void {
    if (this.kind === 'auto') {
      this.kind = 'none';
      this.events.onAutoResume();
    }
    // 'manual' stays manual; 'none' stays none.
  }

  /** Restart / quit / new game: clear any pause, closing the hub. */
  public reset(): void {
    if (this.kind === 'manual') {
      this.kind = 'none';
      this.events.onManualResume();
    } else if (this.kind === 'auto') {
      this.kind = 'none';
      this.events.onAutoResume();
    }
  }
}

function main(): void {
  const canvas = requireElement('stage', HTMLCanvasElement);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('pose-arcade: 2D canvas context is unavailable');
  }
  const context: CanvasRenderingContext2D = ctx;

  const hubSection = requireElement('hub', HTMLElement);
  const stageSection = requireElement('stage-section', HTMLElement);
  const cameraStatus = requireElement('camera-status', HTMLParagraphElement);
  const gameCards = requireElement('game-cards', HTMLDivElement);
  const gameHud = requireElement('game-hud', HTMLDivElement);
  const outOfFrame = requireElement('out-of-frame', HTMLParagraphElement);
  const btnCamera = requireElement('btn-camera', HTMLButtonElement);
  const btnSim = requireElement('btn-sim', HTMLButtonElement);
  const btnPause = requireElement('btn-pause', HTMLButtonElement);
  const btnRestart = requireElement('btn-restart', HTMLButtonElement);
  const btnQuit = requireElement('btn-quit', HTMLButtonElement);
  const btnMute = requireElement('btn-mute', HTMLButtonElement);
  const btnDebug = requireElement('btn-debug', HTMLButtonElement);
  const btnVideo = requireElement('btn-video', HTMLButtonElement);
  const btnRetry = requireElement('btn-retry', HTMLButtonElement);
  const btnFullscreen = requireElement('btn-fullscreen', HTMLButtonElement);

  const sfx = new SoundEffects();
  const tracker = new BodyStateTracker();
  /** The player on screen: a chunky miner in the default outfit, drawn
   * from the raw landmarks for every game. The stickman skeleton is a
   * debug overlay only (see the render step). */
  const avatar = new AvatarRenderer();

  const mouse = new MouseSource();
  const replay = new ReplaySource(parseReplayClip(replayFixture));

  let video: HTMLVideoElement | null = null;
  let mediaPipe: MediaPipePoseSource | null = null;
  let activeSource: PoseFrameSource | null = null;
  let activeGame: Game | null = null;
  let pendingGameId: string | null = null;
  let showDebug: boolean = true;
  /**
   * Camera video is hidden by default: the player sees the game + their
   * avatar, never themselves. The "Show camera" toggle (button or V key)
   * shows it letterboxed, for calibration only.
   */
  let showVideo: boolean = false;
  let latestBody: BodyState | null = null;
  let latestLandmarks: readonly NormalizedLandmark[] | null = null;
  /**
   * Timestamp of the last DISTINCT pose frame received. frameAt() returns
   * the same frame (same timestamp) while throttled or stalled, so a
   * changed timestamp is how the hub knows fresh data arrived.
   */
  let lastFrameTimestampMs: number | null = null;
  /**
   * rAF time (ms) a distinct pose frame was last received; null when none
   * yet. The gate's staleness check reads `nowMs - lastFrameReceivedMs` —
   * arrival time, not the frame's own timestamp, so a source replaying
   * one frozen frame cannot look fresh.
   */
  let lastFrameReceivedMs: number | null = null;

  // --- body-visible gate state (see src/core/gate.ts) ---
  /** Last ms a usable body was seen; null when never. Feeds the grace period. */
  let lastUsableMs: number | null = null;
  /** Latest pure gate decision, computed in update(), read in render(). */
  let currentGate: GateState = {
    gated: true,
    reason: 'no-body',
    message: 'Step back so I can see your whole body',
    lastUsableMs: null,
  };
  /**
   * Two pause kinds (v3.1) — see `PauseController`. The controller owns
   * the state; these callbacks wire it to the game, the Pause button
   * label, and the town-hub overlay (Worker B's module, via
   * `registerHubOverlay`). The callbacks read `activeGame` at call
   * time, so they stay correct across game switches.
   */
  const pause = new PauseController({
    onManualPause: () => {
      activeGame?.pause();
      btnPause.textContent = '▶ Play';
      hubOverlay?.open();
    },
    onManualResume: () => {
      activeGame?.resume();
      btnPause.textContent = '⏸ Pause';
      hubOverlay?.close();
    },
    onAutoPause: () => {
      activeGame?.pause();
      // Label stays '⏸ Pause': pressing it now converts to a manual
      // pause (opens the hub) instead of resuming into a closed gate.
    },
    onAutoResume: () => {
      activeGame?.resume();
      btnPause.textContent = '⏸ Pause';
    },
  });
  /**
   * True when a game was picked but its simulation has not started yet:
   * `start()` is deferred until the gate opens, so a game never runs (or
   * loses) while no usable body is present.
   */
  let pendingStart: boolean = false;

  /** Which pose-model state the gate should see for the active source. */
  function modelState(): ModelState {
    if (mediaPipe === null) return 'not-applicable';
    if (mediaPipe.error !== null) return 'failed';
    if (mediaPipe.inferenceStopped) return 'inference-stopped';
    return mediaPipe.ready ? 'ready' : 'loading';
  }

  /** Apply the gate decision through the pause state machine. */
  function applyGate(gate: GateState): void {
    currentGate = gate;
    lastUsableMs = gate.lastUsableMs;
    if (activeGame === null) return;
    if (gate.gated) pause.gateClosed();
    else pause.gateOpened();
  }

  // ---------------------------------------------------------------- hub ---

  for (const game of Object.values(GAMES)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'game-card' + (game.enabled ? '' : ' coming-soon');
    card.disabled = !game.enabled;
    const title = document.createElement('h2');
    title.textContent = game.title;
    const blurb = document.createElement('p');
    blurb.textContent =
      GAME_BLURBS[game.id] ?? (game.enabled ? '' : 'Coming soon.');
    card.append(title, blurb);
    if (game.enabled) {
      card.addEventListener('click', () => {
        pickGame(game.id);
      });
    }
    gameCards.append(card);
  }

  function setStatus(message: string): void {
    cameraStatus.textContent = message;
  }

  function pickGame(gameId: string): void {
    if (activeSource === null) {
      pendingGameId = gameId;
      setStatus('Turn the camera on first — or play without a camera below!');
      btnCamera.focus();
      return;
    }
    startGame(gameId);
  }

  function startGame(gameId: string): void {
    const Constructor = GAME_CONSTRUCTORS[gameId];
    if (Constructor === undefined) return;
    stopGame();
    tracker.reset();
    activeGame = new Constructor(sfx);
    // Do NOT call start() yet: the simulation starts only once the gate
    // opens (a usable body is present, model loaded). The loop's update
    // calls start() via pendingStart the first frame the gate is open.
    pendingStart = true;
    hubSection.hidden = true;
    stageSection.hidden = false;
    btnPause.textContent = '⏸ Pause';
    loop.start();
  }

  function stopGame(): void {
    if (activeGame !== null) {
      activeGame.stop();
      activeGame = null;
    }
    loop.stop();
    latestBody = null;
    latestLandmarks = null;
    lastFrameTimestampMs = null;
    lastFrameReceivedMs = null;
    pendingStart = false;
    // Clearing the pause closes the hub when one was open (manual) and
    // resumes the game state; the game itself is already stopped above,
    // so the resume is a no-op for it.
    pause.reset();
    lastUsableMs = null;
    currentGate = {
      gated: true,
      reason: 'no-body',
      message: 'Step back so I can see your whole body',
      lastUsableMs: null,
    };
  }

  function quitToHub(): void {
    stopGame();
    // Leaving the stage while fullscreen would leave the (now hidden)
    // stage fullscreened: exit first.
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen();
    }
    stageSection.hidden = true;
    hubSection.hidden = false;
    outOfFrame.hidden = true;
    outOfFrame.classList.remove('ok');
    gameHud.textContent = '';
    btnRetry.disabled = true;
    setStatus('');
  }

  // ------------------------------------------------------------- sources ---

  async function startCameraSource(): Promise<void> {
    btnCamera.disabled = true;
    setStatus('Starting camera…');
    try {
      video = await startCamera();
    } catch (error) {
      btnCamera.disabled = false;
      if (error instanceof CameraError) {
        setStatus(`${error.message} — or tap "Play Without Camera".`);
      } else {
        setStatus('Camera did not start — tap "Play Without Camera".');
      }
      return;
    }
    mediaPipe = new MediaPipePoseSource(defaultMediaPipeOptions(video));
    mediaPipe.start(globalThis.performance.now());
    activeSource = mediaPipe;
    btnRetry.disabled = false;
    setStatus('Camera on! Pick a game — stand back so your whole body fits. You won\'t see yourself — you\'ll see your miner.');
    btnSim.disabled = true;
    if (pendingGameId !== null) {
      const gameId = pendingGameId;
      pendingGameId = null;
      startGame(gameId);
    }
  }

  /**
   * Restart the camera feed from scratch: stop the current source and
   * video, then re-run startCameraSource. This is the way back from a
   * frozen feed or a stopped inference — resuming the same source would
   * keep returning the same dead frame. The picked game keeps running
   * (gated) while the new source warms up; the gate reopens it once a
   * fresh usable body arrives.
   */
  async function restartCameraSource(): Promise<void> {
    if (mediaPipe === null) return;
    mediaPipe.stop();
    mediaPipe = null;
    if (video !== null) {
      stopCamera(video);
      video = null;
    }
    activeSource = null;
    latestBody = null;
    latestLandmarks = null;
    lastFrameTimestampMs = null;
    lastFrameReceivedMs = null;
    lastUsableMs = null;
    btnCamera.disabled = false;
    await startCameraSource();
  }

  function startSimSource(): void {
    activeSource = mouse;
    mouse.start(globalThis.performance.now());
    setStatus(
      'Playing without a camera — move the mouse to move, hold it to raise an arm!',
    );
    btnCamera.disabled = true;
    btnSim.disabled = true;
    if (pendingGameId !== null) {
      const gameId = pendingGameId;
      pendingGameId = null;
      startGame(gameId);
    }
  }

  function startReplaySource(): void {
    activeSource = replay;
    replay.start(globalThis.performance.now());
    setStatus('Replay mode — watching a recorded play session.');
    if (pendingGameId !== null) {
      const gameId = pendingGameId;
      pendingGameId = null;
      startGame(gameId);
    }
  }

  btnCamera.addEventListener('click', () => {
    sfx.unlock();
    void startCameraSource();
  });
  btnSim.addEventListener('click', () => {
    sfx.unlock();
    startSimSource();
  });

  // ------------------------------------------------------------ controls ---

  btnPause.addEventListener('click', () => {
    if (activeGame === null) return;
    // Spacebar / Pause button toggle a MANUAL pause. During an
    // auto-pause this converts to manual (opens the hub) instead of
    // being inert — see PauseController.toggleManual.
    pause.toggleManual();
  });
  btnRestart.addEventListener('click', () => {
    if (activeGame === null) return;
    activeGame.restart();
    // Restart clears any pause (and closes the hub when one was open);
    // the resume event sets the Pause label back.
    pause.reset();
    // Restart re-arms the game; if the gate is closed the next update
    // pauses it again until a usable body returns, so no simulation runs
    // while unseen. If the game was still pending its first start, the
    // restart counts as that start.
    pendingStart = false;
  });
  btnQuit.addEventListener('click', quitToHub);
  btnMute.addEventListener('click', () => {
    sfx.setMuted(!sfx.isMuted);
    btnMute.textContent = sfx.isMuted ? '🔇 Sound Off' : '🔊 Sound On';
  });
  btnDebug.addEventListener('click', () => {
    showDebug = !showDebug;
    btnDebug.textContent = showDebug ? '🔍 Debug: On' : '🔍 Debug: Off';
  });
  // The debug toggle is video-independent: D / this button only show or
  // hide the debug HUD. The camera video has its own toggle below.
  btnDebug.textContent = showDebug ? '🔍 Debug: On' : '🔍 Debug: Off';
  btnVideo.addEventListener('click', () => {
    showVideo = !showVideo;
    btnVideo.textContent = showVideo ? '📷 Hide Camera' : '📷 Show Camera';
  });
  btnRetry.addEventListener('click', () => {
    sfx.unlock();
    void restartCameraSource();
  });
  // Fullscreen (Swing Lab v3): the whole stage section — canvas, HUD and
  // controls — goes fullscreen, so the game fills the screen on a laptop
  // or a big monitor. The button label follows the real state (the user
  // can also leave with Esc), via the `fullscreenchange` event. A denied
  // request (no user gesture, unsupported browser) just stays windowed.
  function updateFullscreenLabel(): void {
    btnFullscreen.textContent =
      document.fullscreenElement !== null
        ? '⛶ Exit Fullscreen'
        : '⛶ Fullscreen';
  }
  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement !== null) {
        await document.exitFullscreen();
      } else {
        await stageSection.requestFullscreen();
      }
    } catch {
      // Fullscreen unavailable or denied — stay in windowed mode.
    }
    updateFullscreenLabel();
  }
  btnFullscreen.addEventListener('click', () => {
    void toggleFullscreen();
  });
  document.addEventListener('fullscreenchange', updateFullscreenLabel);
  updateFullscreenLabel();
  if (sfx.isMuted) btnMute.textContent = '🔇 Sound Off';

  // -------------------------------------------------------------- input ---

  function pointerToCanvasPx(event: PointerEvent): Vec2 | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  canvas.addEventListener('pointermove', (event) => {
    if (activeSource !== mouse) return;
    const pixel = pointerToCanvasPx(event);
    if (pixel === null) return;
    const button = (event.buttons & 2) !== 0 ? 2 : 0;
    mouse.setPointer(
      toNormalized(pixel, canvas.width, canvas.height),
      event.buttons > 0,
      button,
    );
  });
  canvas.addEventListener('pointerdown', (event) => {
    sfx.unlock();
    if (activeSource !== mouse) return;
    const pixel = pointerToCanvasPx(event);
    if (pixel === null) return;
    mouse.setPointer(
      toNormalized(pixel, canvas.width, canvas.height),
      true,
      event.button,
    );
  });
  canvas.addEventListener('pointerup', (event) => {
    if (activeSource !== mouse) return;
    const pixel = pointerToCanvasPx(event);
    if (pixel === null) return;
    mouse.setPointer(toNormalized(pixel, canvas.width, canvas.height), false);
  });
  // Right-click raises the right arm in the sim — don't show the menu.
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'a' && activeSource === mouse) mouse.setKeyArm('left', true);
    if (key === 'd' && activeSource === mouse) mouse.setKeyArm('right', true);
    if (key === 'q' && activeSource === mouse) mouse.setKeyArmAngled('left', true);
    if (key === 'e' && activeSource === mouse) mouse.setKeyArmAngled('right', true);
    if (key === ' ' && activeGame !== null) {
      // Spacebar is the pause toggle everywhere (v3.1): it used to be
      // the mouse-sim jump key, which now lives on W. `event.repeat`
      // is filtered above, so holding Space cannot toggle repeatedly.
      // preventDefault stops the page scrolling on the toggle.
      event.preventDefault();
      pause.toggleManual();
    }
    // W (hold) is the mouse-sim jump key (v3.1): Space is pause now.
    // The real-camera body jump is unaffected — it comes from
    // landmarks, not the key.
    if (key === 'w' && activeSource === mouse) mouse.setJumping(true);
    if (key === 's' && activeSource === mouse) mouse.setDucking(true);
    if (key === 'm') btnMute.click();
    if (key === 'v') btnVideo.click();
    if (key === 'f') btnFullscreen.click();
    if (key === 'd' && activeSource !== mouse) {
      // 'd' is the right-arm key for the sim; outside the sim it toggles debug.
      btnDebug.click();
    }
  });
  document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'a' && activeSource === mouse) mouse.setKeyArm('left', false);
    if (key === 'd' && activeSource === mouse) mouse.setKeyArm('right', false);
    if (key === 'q' && activeSource === mouse) mouse.setKeyArmAngled('left', false);
    if (key === 'e' && activeSource === mouse) mouse.setKeyArmAngled('right', false);
    if (key === 'w' && activeSource === mouse) mouse.setJumping(false);
    if (key === 's' && activeSource === mouse) mouse.setDucking(false);
  });

  // -------------------------------------------------------------- loop ---

  const loop = createFixedStepLoop({
    fixedDtMs: LOOP.fixedDtMs,
    maxFrameMs: LOOP.maxFrameMs,
    maxUpdatesPerFrame: LOOP.maxUpdatesPerFrame,
    update: (dtMs, nowMs) => {
      if (activeSource === null || activeGame === null) return;
      // Pose frames are fetched once per rendered frame in render(),
      // never here: calling frameAt once per update step fed
      // detectForVideo the same timestamp several times on catch-up
      // frames, which MediaPipe VIDEO mode rejects (Nov 4, 2026 freeze).
      // Body-visible gate: evaluated every step from the latest body state
      // and the model state. While gated the simulation never advances.
      // frameAgeMs is the age of the last DISTINCT frame received, so a
      // frozen feed closes the gate even when the last frame looked fine.
      const gateOptions: GateOptions = { gracePeriodMs: GATE.gracePeriodMs };
      if (lastFrameReceivedMs !== null) {
        gateOptions.frameAgeMs = nowMs - lastFrameReceivedMs;
      }
      const lastError = mediaPipe?.lastError;
      if (lastError !== null && lastError !== undefined) {
        gateOptions.inferenceError = lastError.message;
      }
      const gate = evaluateGate(
        latestBody,
        nowMs,
        lastUsableMs,
        modelState(),
        gateOptions,
      );
      applyGate(gate);
      if (gate.gated) return;
      if (pendingStart && pause.kind === 'none') {
        // A manual pause before the first start defers the start: the
        // game must not start (and un-pause itself via start()) while
        // the player is sitting in the hub. Resuming starts it on the
        // next update.
        activeGame.start();
        pendingStart = false;
      }
      activeGame.update(dtMs, nowMs, latestBody, latestLandmarks);
    },
    render: (_alpha, nowMs) => {
      // Inference runs ONCE per rendered frame, here — the loop's update
      // steps share the frame this fetched, so detectForVideo never sees
      // the same timestamp twice in one frame. A frame counts as new only
      // when its timestamp changed: a throttled or stalled source keeps
      // returning the same frame, and the gate's staleness check must see
      // that age grow instead of being reset by a repeat.
      if (activeSource !== null && activeGame !== null) {
        const frame = activeSource.frameAt(nowMs);
        if (frame !== null && frame.timestampMs !== lastFrameTimestampMs) {
          lastFrameTimestampMs = frame.timestampMs;
          lastFrameReceivedMs = nowMs;
          latestBody = tracker.update(frame);
          latestLandmarks = frame.landmarks;
        }
      }

      // Fixed landscape stage, ALWAYS — never the video's intrinsic size.
      syncCanvasBackingStore(canvas, STAGE.width, STAGE.height);

      // Video is hidden by default: stage background + avatar only.
      // Shown letterboxed only while the calibration toggle is on.
      if (video !== null && showVideo) {
        drawVideoMirrored(context, video, canvas.width, canvas.height);
      } else {
        drawStageBackground(context, canvas.width, canvas.height);
      }

      // The avatar is the player on screen for every game. The stickman
      // skeleton is a debug overlay only: on top of the avatar, only
      // while the debug HUD is on (D key), never the default view.
      if (latestLandmarks !== null) {
        avatar.draw(
          context,
          latestLandmarks,
          canvas.width,
          canvas.height,
          OUTFIT,
          nowMs,
        );
        if (showDebug) {
          drawSkeleton(context, latestLandmarks, canvas.width, canvas.height);
        }
      }

      if (activeGame !== null) {
        activeGame.render(context, nowMs, latestBody, latestLandmarks);
        gameHud.innerHTML = activeGame.hudHtml();
      }

      // Blocking overlay on the stage itself when gated: model failure
      // says so loudly (never the "step back" message), otherwise the
      // framing message + ghost outline. Never drawn when the gate is open,
      // and never drawn over a manual pause — the manual overlay below
      // (or the hub) owns that surface.
      if (activeGame !== null && currentGate.gated && pause.kind !== 'manual') {
        const isModel = currentGate.reason !== 'no-body';
        drawBlockingOverlay(context, canvas.width, canvas.height, {
          title:
            !isModel && pause.kind === 'auto'
              ? 'Step back into frame'
              : currentGate.message,
          subtitle: isModel
            ? ''
            : 'Arms out wide — shoulders and hips in view',
          showGhost: !isModel,
        });
      }

      // Manual pause surface (v3.1): the game is paused by the player,
      // not the gate, so the gate overlay above does not apply. Until
      // Worker B's town-hub overlay registers (registerHubOverlay),
      // the canvas says which kind of pause this is; once the hub is
      // registered it owns the surface and this stays out of the way.
      if (activeGame !== null && pause.kind === 'manual' && hubOverlay === null) {
        drawBlockingOverlay(context, canvas.width, canvas.height, {
          title: 'Paused — press Space to resume',
          subtitle: '',
          showGhost: false,
        });
      }

      // Live body indicator (DOM, readable on a phone): green when a
      // usable body is in frame, red when gated. The old code hid the
      // warning exactly when there was no body at all — backwards.
      if (activeGame !== null) {
        outOfFrame.hidden = false;
        if (currentGate.reason === 'model-failed') {
          outOfFrame.textContent =
            '❌ Pose model failed to load — check your connection and reload.';
          outOfFrame.classList.remove('ok');
        } else if (currentGate.reason === 'model-loading') {
          outOfFrame.textContent = '⏳ Loading pose model…';
          outOfFrame.classList.remove('ok');
        } else if (currentGate.gated) {
          // Auto pause (v3.1): the overlay/HUD say "Step back into
          // frame" for a lost body; model problems keep the gate's own
          // message (handled in the branches above).
          outOfFrame.textContent =
            pause.kind === 'auto' && currentGate.reason === 'no-body'
              ? '⚠️ Step back into frame.'
              : `⚠️ ${currentGate.message}.`;
          outOfFrame.classList.remove('ok');
        } else {
          outOfFrame.textContent = '✅ Body found — you\'re good to play!';
          outOfFrame.classList.add('ok');
        }
      }

      if (showDebug && activeSource !== null) {
        // Inline narrowing (not the isCamera alias): aliased-condition
        // narrowing does not survive into these ternaries under this
        // tsconfig, so each use checks mediaPipe directly.
        let inferenceHz = 0;
        let lastFrameMs: number | null = latestBody?.timestampMs ?? null;
        let modelReady: boolean | null = null;
        if (mediaPipe !== null && activeSource === mediaPipe) {
          inferenceHz = mediaPipe.inferenceStats.hz;
          lastFrameMs = mediaPipe.lastFrameTimestampMs;
          modelReady = mediaPipe.ready;
        }
        const readout: HudReadout = {
          fps: loop.stats.fps,
          inferenceHz,
          poseMatchScore: null,
          sourceId: activeSource.id,
          body: latestBody,
          modelReady,
          pauseKind: pause.kind,
          lastFrameAgeMs: lastFrameMs === null ? null : nowMs - lastFrameMs,
          landmarkCount:
            latestLandmarks === null ? null : latestLandmarks.length,
        };
        // Same inline-narrowing rule as above for the camera-only fields.
        if (mediaPipe !== null && activeSource === mediaPipe) {
          readout.inferenceErrors = mediaPipe.consecutiveFailures;
          readout.lastInferenceError = mediaPipe.lastError?.message ?? null;
          readout.delegate = mediaPipe.delegateInUse;
          readout.videoFrozen = mediaPipe.videoFrozen;
          readout.videoCurrentTimeAgeMs = mediaPipe.videoCurrentTimeAgeMs;
        }
        // Weak-swing detail comes from the active game, not the tracker.
        if (activeGame instanceof SwingLabGame) {
          readout.swingWeakDetail = activeGame.snapshot().lastWeakDetail;
        }
        drawHud(context, readout);
      }

      // Surface a model-load failure in the hub status line too (the
      // stage overlay above is the loud, in-game surface).
      if (mediaPipe !== null && mediaPipe.error !== null) {
        setStatus(
          `Pose model failed to load: ${mediaPipe.error.message} — try "Play Without Camera".`,
        );
      }
    },
  });

  // ?source=mouse | ?source=replay | ?source=camera — the camera still needs
  // its explicit tap, so ?source=camera only pre-selects the button.
  const params = new URLSearchParams(globalThis.location.search);
  const requested = params.get(SOURCE_SELECTION.queryParam);
  if (requested === 'mouse') {
    startSimSource();
  } else if (requested === 'replay') {
    startReplaySource();
  }
}

/**
 * Boot the hub only where a DOM exists. Importing this module in a test
 * (node, no DOM) must not boot the hub: the pause state machine below is
 * unit-tested from here (`src/main.test.ts`).
 */
if (typeof document !== 'undefined') {
  main();
}
