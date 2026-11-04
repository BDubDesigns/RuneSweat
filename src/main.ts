/**
 * Lara's Pose Games — hub bootstrap.
 *
 * The hub owns: the camera, the pose source, the fixed-timestep loop, the
 * video/skeleton rendering, and the DOM. A game owns only its own simulation
 * + canvas drawing + HUD string (see src/games/game.ts).
 *
 * Flow: pick a game -> turn the camera on (or play without a camera) ->
 * play. The mouse simulator is offered automatically if the camera is
 * denied or unavailable, so the games are always playable.
 *
 * Mirroring: in code only, in `toCanvas()` / `drawVideoMirrored()`. The
 * canvas is never flipped with CSS.
 */

import './styles.css';

import replayFixture from '../fixtures/replay-sweep.json';
import { GAMES, LOOP, SOURCE, SOURCE_SELECTION } from './core/config';
import { startCamera, CameraError } from './core/camera';
import { SoundEffects } from './core/audio';
import { BodyStateTracker, type BodyState } from './core/bodyState';
import { createFixedStepLoop } from './core/loop';
import { drawHud } from './debug/hud';
import { syncCanvasBackingStore, toNormalized, type Vec2 } from './render/stage';
import { drawSkeleton, drawStageBackground, drawVideoMirrored } from './render/renderer';
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

const GAME_CONSTRUCTORS: Record<string, GameConstructor> = {
  'space-invaders': SpaceInvadersGame,
  'dance-drop': DanceDropGame,
};

const GAME_BLURBS: Record<string, string> = {
  'space-invaders':
    '🚀 Move your body to fly the ship. Raise an arm to shoot!',
  'dance-drop': '💃 Copy the falling pose before it lands in your zone!',
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

  const sfx = new SoundEffects();
  const tracker = new BodyStateTracker();

  const mouse = new MouseSource();
  const replay = new ReplaySource(parseReplayClip(replayFixture));

  let video: HTMLVideoElement | null = null;
  let mediaPipe: MediaPipePoseSource | null = null;
  let activeSource: PoseFrameSource | null = null;
  let activeGame: Game | null = null;
  let pendingGameId: string | null = null;
  let showDebug: boolean = true;
  let latestBody: BodyState | null = null;
  let latestLandmarks: readonly NormalizedLandmark[] | null = null;

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
    activeGame.start();
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
  }

  function quitToHub(): void {
    stopGame();
    stageSection.hidden = true;
    hubSection.hidden = false;
    outOfFrame.hidden = true;
    gameHud.textContent = '';
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
    setStatus('Camera on! Pick a game — stand back so your whole body fits.');
    btnSim.disabled = true;
    if (pendingGameId !== null) {
      const gameId = pendingGameId;
      pendingGameId = null;
      startGame(gameId);
    }
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
    if (activeGame.paused) {
      activeGame.resume();
      btnPause.textContent = '⏸ Pause';
    } else {
      activeGame.pause();
      btnPause.textContent = '▶ Play';
    }
  });
  btnRestart.addEventListener('click', () => {
    activeGame?.restart();
    btnPause.textContent = '⏸ Pause';
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
    if (key === ' ' && activeSource === mouse) {
      event.preventDefault();
      mouse.setJumping(true);
    }
    if (key === 's' && activeSource === mouse) mouse.setDucking(true);
    if (key === 'm') btnMute.click();
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
    if (key === ' ' && activeSource === mouse) mouse.setJumping(false);
    if (key === 's' && activeSource === mouse) mouse.setDucking(false);
  });

  // -------------------------------------------------------------- loop ---

  const loop = createFixedStepLoop({
    fixedDtMs: LOOP.fixedDtMs,
    maxFrameMs: LOOP.maxFrameMs,
    maxUpdatesPerFrame: LOOP.maxUpdatesPerFrame,
    update: (dtMs, nowMs) => {
      if (activeSource === null || activeGame === null) return;
      const frame = activeSource.frameAt(nowMs);
      if (frame !== null) {
        latestBody = tracker.update(frame);
        latestLandmarks = frame.landmarks;
      }
      activeGame.update(dtMs, nowMs, latestBody, latestLandmarks);
    },
    render: (_alpha, nowMs) => {
      // Size the canvas to the source: real video dims, else the placeholder.
      const sourceWidth =
        video !== null && video.videoWidth > 0 ? video.videoWidth : SOURCE.width;
      const sourceHeight =
        video !== null && video.videoHeight > 0 ? video.videoHeight : SOURCE.height;
      syncCanvasBackingStore(canvas, sourceWidth, sourceHeight);

      if (video !== null) {
        drawVideoMirrored(context, video, canvas.width, canvas.height);
      } else {
        drawStageBackground(context, canvas.width, canvas.height);
      }

      if (latestLandmarks !== null) {
        drawSkeleton(context, latestLandmarks, canvas.width, canvas.height);
      }

      if (activeGame !== null) {
        activeGame.render(context, nowMs, latestBody, latestLandmarks);
        gameHud.innerHTML = activeGame.hudHtml();
      }

      outOfFrame.hidden =
        latestBody === null || latestBody.present === false
          ? true
          : latestBody.inFrame;

      if (showDebug && activeSource !== null) {
        const inferenceHz =
          mediaPipe !== null && activeSource === mediaPipe
            ? mediaPipe.inferenceStats.hz
            : 0;
        drawHud(context, {
          fps: loop.stats.fps,
          inferenceHz,
          poseMatchScore: null,
          sourceId: activeSource.id,
          body: latestBody,
        });
      }

      // Surface a model-load failure in the hub status line.
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

main();
