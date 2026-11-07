/**
 * YouVille 0.1 bootstrap: the DOM, the camera, the loop.
 *
 * The session (`session.ts`) owns all game state; this file only wires
 * inputs to it and draws it. Privacy: the camera is started only from
 * the explicit "Use camera" button; frames go to the on-device
 * PoseLandmarker and nothing is stored or sent anywhere. No
 * microphone, no network calls, no localStorage.
 */
import { BodyStateTracker, type BodyState } from '../core/bodyState';
import { CameraError, startCamera, stopCamera } from '../core/camera';
import { LOOP } from '../core/config';
import { createFixedStepLoop } from '../core/loop';
import { syncCanvasBackingStore } from '../render/stage';
import {
  MediaPipePoseSource,
  defaultMediaPipeOptions,
} from '../tracking/mediapipeSource';
import type { NormalizedLandmark } from '../tracking/poseTypes';
import { versionLabel } from '../core/version';
import { renderScene } from './art/renderScene';
import { WORLD } from './config';
import { DOOR_INPUT_METHODS, DOOR_METHOD_LABELS } from './interaction';
import { YouVilleSession, type PoseInput } from './session';

function requireElement<T extends HTMLElement>(
  id: string,
  ctor: new () => T,
): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`youville: #${id} is missing from index.html`);
  }
  return el;
}

export function startYouVille(): void {
  const canvas = requireElement('stage', HTMLCanvasElement);
  const ctx2d = canvas.getContext('2d');
  if (ctx2d === null) throw new Error('youville: 2D canvas is unavailable');
  const ctx: CanvasRenderingContext2D = ctx2d;
  const statusEl = requireElement('status', HTMLParagraphElement);
  const btnCamera = requireElement('btn-camera', HTMLButtonElement);
  const btnLeft = requireElement('btn-left', HTMLButtonElement);
  const btnRight = requireElement('btn-right', HTMLButtonElement);
  const btnEnter = requireElement('btn-enter', HTMLButtonElement);
  const btnSwap = requireElement('btn-swap', HTMLButtonElement);
  const methodGroup = requireElement('door-method', HTMLFieldSetElement);
  requireElement('app-version', HTMLElement).textContent = versionLabel();

  const session = new YouVilleSession();
  const tracker = new BodyStateTracker();

  let video: HTMLVideoElement | null = null;
  let source: MediaPipePoseSource | null = null;
  let cameraStarting = false;
  let latestBody: BodyState | null = null;
  let latestLandmarks: readonly NormalizedLandmark[] | null = null;
  let lastFrameTs: number | null = null;
  let lastReceivedMs: number | null = null;
  let debug = false;

  // ------------------------------------------------------------ camera ---

  function setStatus(message: string): void {
    statusEl.textContent = message;
  }

  async function turnCameraOn(): Promise<void> {
    if (cameraStarting) return;
    cameraStarting = true;
    btnCamera.disabled = true;
    setStatus('Starting camera…');
    try {
      video = await startCamera();
    } catch (error) {
      btnCamera.disabled = false;
      cameraStarting = false;
      setStatus(
        error instanceof CameraError
          ? `${error.message} Touch and keyboard controls still work.`
          : 'The camera did not start. Touch and keyboard controls still work.',
      );
      return;
    }
    source = new MediaPipePoseSource(defaultMediaPipeOptions(video));
    source.start(globalThis.performance.now());
    cameraStarting = false;
    btnCamera.disabled = false;
    btnCamera.textContent = '📷 Turn camera off';
    setStatus(
      'Camera on. Step back so your head, shoulders and hips fit. Nothing leaves your device.',
    );
  }

  function turnCameraOff(): void {
    if (source !== null) source.stop();
    source = null;
    if (video !== null) stopCamera(video);
    video = null;
    latestBody = null;
    latestLandmarks = null;
    lastFrameTs = null;
    lastReceivedMs = null;
    tracker.reset();
    btnCamera.textContent = '📷 Use camera';
    setStatus('Camera off. Walk with the arrows, use Enter at the door.');
  }

  btnCamera.addEventListener('click', () => {
    if (source === null) void turnCameraOn();
    else turnCameraOff();
  });

  // ----------------------------------------------------------- controls ---

  function holdButton(button: HTMLButtonElement, dir: -1 | 1): void {
    const down = (e: Event): void => {
      e.preventDefault();
      session.touchDir = dir;
    };
    const up = (): void => {
      if (session.touchDir === dir) session.touchDir = 0;
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
  }
  holdButton(btnLeft, -1);
  holdButton(btnRight, 1);

  btnEnter.addEventListener('click', () => {
    session.pressEnter(globalThis.performance.now());
  });
  btnSwap.addEventListener('click', () => {
    session.creator.swapHands();
    btnSwap.textContent = `🤚 Pointing hand: ${session.creator.pointerHand}`;
  });

  for (const method of DOOR_INPUT_METHODS) {
    const label = document.createElement('label');
    label.className = 'method';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'door-method';
    input.value = method;
    input.checked = method === session.doorMethod;
    input.addEventListener('change', () => {
      if (input.checked) session.setDoorMethod(method);
    });
    label.append(input, ` ${DOOR_METHOD_LABELS[method]}`);
    methodGroup.append(label);
  }

  function worldPoint(e: PointerEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * WORLD.width,
      y: ((e.clientY - r.top) / r.height) * WORLD.height,
    };
  }
  canvas.addEventListener('pointermove', (e) => {
    if (session.roomId === 'closet') session.creator.setMouseHover(worldPoint(e));
  });
  canvas.addEventListener('pointerleave', () => {
    session.creator.setMouseHover(null);
  });
  canvas.addEventListener('pointerdown', (e) => {
    const now = globalThis.performance.now();
    const p = worldPoint(e);
    if (session.roomId === 'closet') {
      session.creator.setMouseHover(p);
      session.handleCreatorResult(session.creator.tap(p, now), now);
      return;
    }
    const door = session.room.doors.find(
      (d) =>
        p.x >= d.hitRect.x &&
        p.x <= d.hitRect.x + d.hitRect.w &&
        p.y >= d.hitRect.y &&
        p.y <= d.hitRect.y + d.hitRect.h,
    );
    if (door !== undefined) session.pressEnter(now);
  });

  const heldKeys = new Set<string>();
  function syncKeyboardWalk(): void {
    if (session.roomId === 'closet') return;
    const left = heldKeys.has('arrowleft') || heldKeys.has('a');
    const right = heldKeys.has('arrowright') || heldKeys.has('d');
    session.touchDir = left === right ? 0 : left ? -1 : 1;
  }
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) {
      if (e.key === 'Enter' || e.key === ' ') return; // let native controls work
    }
    const key = e.key.toLowerCase();
    const now = globalThis.performance.now();
    if (session.roomId === 'closet') {
      if (key === 'arrowleft' || key === 'a') session.creator.moveKeyboardFocus(-1, 0);
      else if (key === 'arrowright' || key === 'd') session.creator.moveKeyboardFocus(1, 0);
      else if (key === 'arrowup' || key === 'w') session.creator.moveKeyboardFocus(0, -1);
      else if (key === 'arrowdown' || key === 's') session.creator.moveKeyboardFocus(0, 1);
      else if (key === 'enter' || key === ' ') {
        session.handleCreatorResult(session.creator.confirmKeyboardFocus(now), now);
      } else if (key === 'h') btnSwap.click();
      else return;
      e.preventDefault();
      return;
    }
    if (key === 'enter' || key === ' ') {
      session.pressEnter(now);
      e.preventDefault();
    } else if (['arrowleft', 'arrowright', 'a', 'd'].includes(key)) {
      heldKeys.add(key);
      syncKeyboardWalk();
      e.preventDefault();
    } else if (key === 'g') {
      debug = !debug;
    }
  });
  window.addEventListener('keyup', (e) => {
    heldKeys.delete(e.key.toLowerCase());
    syncKeyboardWalk();
  });
  window.addEventListener('blur', () => {
    heldKeys.clear();
    session.touchDir = 0;
  });

  // --------------------------------------------------------------- loop ---

  function poseInput(): PoseInput {
    return { body: latestBody, receivedAtMs: lastReceivedMs };
  }

  function bannerText(): string | null {
    if (source === null) return null;
    if (source.error !== null) return 'The pose model failed to load. Touch controls still work.';
    if (source.inferenceStopped) return 'Pose tracking stopped. Turn the camera off and on again.';
    if (!source.ready) return 'Loading pose tracking…';
    if (!session.poseFresh) {
      return "I can't see you. Step back so your head, shoulders and hips are in view.";
    }
    return null;
  }

  const loop = createFixedStepLoop({
    fixedDtMs: LOOP.fixedDtMs,
    maxFrameMs: LOOP.maxFrameMs,
    maxUpdatesPerFrame: LOOP.maxUpdatesPerFrame,
    update: (dtMs, nowMs) => {
      session.update(dtMs, nowMs, source === null ? null : poseInput());
    },
    render: (_alpha, nowMs) => {
      // One pose fetch per rendered frame: detectForVideo must never
      // see the same timestamp twice. A frame is new only when its
      // timestamp changed, so a frozen feed ages instead of looking fresh.
      if (source !== null) {
        const frame = source.frameAt(nowMs);
        if (frame !== null && frame.timestampMs !== lastFrameTs) {
          lastFrameTs = frame.timestampMs;
          lastReceivedMs = nowMs;
          latestBody = tracker.update(frame);
          latestLandmarks = frame.landmarks;
        }
      }
      syncCanvasBackingStore(canvas, WORLD.width, WORLD.height);
      btnEnter.disabled = session.nearbyDoor === null;
      btnSwap.hidden = session.roomId !== 'closet';
      btnLeft.disabled = btnRight.disabled = session.roomId === 'closet';
      const rec = session.gestures.get(session.doorMethod);
      renderScene(ctx, session, {
        nowMs,
        cameraOn: source !== null,
        banner: bannerText(),
        landmarks: latestLandmarks,
        debug,
        debugLines: [
          `room ${session.roomId}  x ${session.mover.x.toFixed(0)}  fresh ${String(session.poseFresh)}`,
          `door ${session.doorMethod}  recognizer ${rec === null ? '-' : rec.debugPhase()}`,
          `L arm ${latestBody?.leftArm.angleDeg.toFixed(0) ?? '-'}  R arm ${latestBody?.rightArm.angleDeg.toFixed(0) ?? '-'}`,
          `lever ${session.creator.leverPhase}  hover ${session.creator.hoveredId ?? '-'}`,
          `fps ${loop.stats.fps.toFixed(0)}  transitions ${String(session.transitionCount)}`,
        ],
      });
    },
  });
  loop.start();
}
