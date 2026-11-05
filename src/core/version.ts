/**
 * App version — SINGLE SOURCE OF TRUTH: `package.json` `version`.
 *
 * This module reads it straight from `package.json` (no mirror
 * constant, so it cannot drift): bump the version in `package.json`,
 * build, deploy. The label shows on the game-select screen
 * (`main.ts` sets `#app-version` at boot) and in the Town Hub
 * (`TownHub.render` draws it top-left), so the build is identifiable
 * at a glance — GitHub Pages serves the HTML with
 * `Cache-Control: max-age=600`, so a stale page can linger ~10
 * minutes after a deploy and the version is how you tell.
 *
 * No update-check machinery in this slice: display only.
 */
import { version } from '../../package.json';

/** The release version, e.g. `'3.4.0'`. */
export const VERSION: string = version;

/** The label as shown to the player, e.g. `'RuneSweat v3.4.0'`. */
export function versionLabel(): string {
  return `RuneSweat v${VERSION}`;
}
