/**
 * Base-relative asset URLs.
 *
 * The app is hosted under a subpath on GitHub Pages (`/lara-pose-games/`),
 * so asset paths must NEVER start with `/`: `/models/...` resolves to the
 * domain root and 404s there, which silently left PoseLandmarker unloaded
 * on the live site (Nov 4, 2026 playtest: no pose frames ever, Game Over
 * score 0) while everything worked on localhost at the root. Vite's
 * `base` is `'./'`, so `import.meta.env.BASE_URL` is `'./'` in the build
 * and joining it with a relative segment gives a subpath-safe URL.
 */

/**
 * Pure join: `base` + `relativePath`, with exactly one separator and no
 * leading slash on the result when `base` is relative. A leading slash on
 * `relativePath` is stripped — callers pass bare relative segments.
 */
export function joinBaseUrl(base: string, relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, '');
  if (base === '') return rel;
  return base.endsWith('/') ? `${base}${rel}` : `${base}/${rel}`;
}

/** Join `relativePath` onto Vite's configured base URL. A base of `/`
 * (vitest / dev at the root) is normalised to `./`: for this single-page
 * app the two are equivalent at the root, and `./` stays correct when the
 * app is served under a subpath, where `/` would escape to the domain root.
 */
export function assetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL === '/' ? './' : import.meta.env.BASE_URL;
  return joinBaseUrl(base, relativePath);
}
