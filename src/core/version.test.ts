import { describe, expect, it } from 'vitest';
import { version as packageVersion } from '../../package.json';
import { VERSION, versionLabel } from './version';

describe('VERSION (single source of truth: package.json)', () => {
  it('is a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches package.json version', () => {
    expect(VERSION).toBe(packageVersion);
  });

  it('labels as "RuneSweat vX.Y.Z"', () => {
    expect(versionLabel()).toBe(`RuneSweat v${VERSION}`);
    expect(versionLabel()).toBe(`RuneSweat v${packageVersion}`);
  });
});
