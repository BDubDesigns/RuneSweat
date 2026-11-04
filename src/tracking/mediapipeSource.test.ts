import { describe, expect, it } from 'vitest';
import { defaultMediaPipeOptions } from './mediapipeSource';

/**
 * The Nov 4, 2026 live-site failure: model + WASM were loaded from
 * absolute paths (`/models/...`, `/wasm`), which 404 under the
 * `/lara-pose-games/` subpath on GitHub Pages while working on localhost
 * at the root — so PoseLandmarker never loaded and no pose frames ever
 * arrived. These tests pin the fix: base-relative paths, never a leading
 * slash.
 */
describe('defaultMediaPipeOptions paths', () => {
  it('builds base-relative model + WASM paths, never absolute ones', () => {
    const video = {} as unknown as HTMLVideoElement;
    const options = defaultMediaPipeOptions(video);
    expect(options.modelAssetPath.startsWith('/')).toBe(false);
    expect(options.wasmPath.startsWith('/')).toBe(false);
    // Vite base is './' in this repo.
    expect(options.modelAssetPath).toBe(
      './models/pose_landmarker_lite.task',
    );
    expect(options.wasmPath).toBe('./wasm');
  });

  it('points at the lite model by default', () => {
    const video = {} as unknown as HTMLVideoElement;
    const options = defaultMediaPipeOptions(video);
    expect(options.modelAssetPath).toContain('pose_landmarker_lite.task');
  });
});
