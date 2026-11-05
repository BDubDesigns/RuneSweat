import { describe, expect, it } from 'vitest';
import { assetUrl, joinBaseUrl } from './assetUrl';

describe('joinBaseUrl', () => {
  it('joins a relative base without doubling the slash', () => {
    expect(joinBaseUrl('./', 'models/pose_landmarker_lite.task')).toBe(
      './models/pose_landmarker_lite.task',
    );
    expect(joinBaseUrl('./', 'wasm')).toBe('./wasm');
  });

  it('joins a subpath base', () => {
    expect(joinBaseUrl('/RuneSweat/', 'models/x.task')).toBe(
      '/RuneSweat/models/x.task',
    );
  });

  it('adds the separator when the base has none', () => {
    expect(joinBaseUrl('.', 'models/x.task')).toBe('./models/x.task');
  });

  it('strips a leading slash from the relative path', () => {
    // A caller passing '/models/...' must never produce an absolute URL.
    expect(joinBaseUrl('./', '/models/x.task')).toBe('./models/x.task');
    expect(joinBaseUrl('/RuneSweat/', '/wasm')).toBe(
      '/RuneSweat/wasm',
    );
  });

  it('never produces a leading-slash URL from a relative base', () => {
    expect(joinBaseUrl('./', 'models/x.task').startsWith('/')).toBe(false);
    expect(joinBaseUrl('./', 'wasm').startsWith('/')).toBe(false);
  });
});

describe('assetUrl', () => {
  it('is base-relative, never an absolute domain-root path', () => {
    // Vite base is './' in this repo, so the built URL starts with './'.
    // Under a subpath host (GitHub Pages) that resolves inside the app;
    // '/models/...' would resolve to the domain root and 404.
    const model = assetUrl('models/pose_landmarker_lite.task');
    const wasm = assetUrl('wasm');
    expect(model.startsWith('/')).toBe(false);
    expect(wasm.startsWith('/')).toBe(false);
    expect(model).toBe('./models/pose_landmarker_lite.task');
    expect(wasm).toBe('./wasm');
  });
});
