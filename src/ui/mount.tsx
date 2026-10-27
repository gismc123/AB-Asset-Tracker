import { createRoot, type Root } from 'react-dom/client';
import { createClient, type MortgageClient } from './api.js';
import { MortgageApp } from './components/MortgageApp.js';
import { styles } from './styles.js';

export interface MountedApp {
  /** Re-check Actual's theme (call after the user switches light/dark). */
  syncTheme(): void;
  /** Blur amounts, following Actual's privacy mode. */
  setPrivacy(on: boolean): void;
  unmount(): void;
}

/** Actual exposes its theme only as CSS variables, so infer dark from the page color. */
function isDark(): boolean {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-pageBackground').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(bg) ?? /^#?([0-9a-f]{3})$/i.exec(bg);
  let rgb: number[] | null = null;
  if (m) {
    const hex = m[1]!.length === 3 ? m[1]!.replace(/./g, '$&$&') : m[1]!;
    rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  } else {
    const r = /rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(bg);
    if (r) rgb = [Number(r[1]), Number(r[2]), Number(r[3])];
  }
  if (!rgb) return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const [r, g, b] = rgb as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** Actual's privacy font, registered by its page (fonts cross into the shadow root). */
function hasRedactedFont(): boolean {
  try {
    return [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Redacted Script');
  } catch {
    return false;
  }
}

/**
 * Render the Mortgage screens into `host` inside a shadow root, so its
 * styles never touch Actual's and the other way round.
 */
export function mountMortgageApp(host: HTMLElement, client: MortgageClient = createClient()): MountedApp {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = styles;
  const container = document.createElement('div');
  container.className = 'mt';
  shadow.append(style, container);

  // Actual's page-wide shortcuts skip keys typed into inputs, but from outside
  // the shadow root every key looks like it came from `host`, so they would
  // swallow keys such as "0". React has already handled the event by the time
  // it bubbles here.
  const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;
  const keepKeysInside = (e: Event) => e.stopPropagation();
  for (const type of KEY_EVENTS) shadow.addEventListener(type, keepKeysInside);

  const root: Root = createRoot(container);
  root.render(<MortgageApp client={client} />);

  const syncTheme = () => container.classList.toggle('dark', isDark());
  syncTheme();
  return {
    syncTheme,
    setPrivacy(on) {
      container.classList.toggle('privacy', on);
      container.classList.toggle('redact', on && hasRedactedFont());
    },
    unmount() {
      for (const type of KEY_EVENTS) shadow.removeEventListener(type, keepKeysInside);
      root.unmount();
      shadow.innerHTML = '';
    },
  };
}
