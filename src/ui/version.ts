/** Set from package.json when the UI is bundled (scripts/build-ui.mjs). */
declare const __APP_VERSION__: string | undefined;

/** The tracker version this bundle was built from, e.g. "0.2.3". */
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export const REPO_URL = 'https://github.com/gismc123/AB-Asset-Tracker';

/** Release notes for this version on GitHub. */
export const RELEASE_URL = VERSION === 'dev' ? `${REPO_URL}/releases` : `${REPO_URL}/releases/tag/v${VERSION}`;
