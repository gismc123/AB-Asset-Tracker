/**
 * The one script the proxy injects into Actual's page.
 *
 * It adds a "Mortgage" item to Actual's sidebar and, when clicked, shows the
 * mortgage screens in the content area next to the sidebar. Everything here
 * is defensive: if Actual's markup changes and the sidebar can't be found,
 * the script does nothing and Actual keeps working exactly as before.
 */
import { mountMortgageApp, type MountedApp } from '../ui/mount.js';

const LOG = '[mortgage-tab]';
const ITEM_ATTR = 'data-mortgage-tab';
/** Sidebar links we try, in order, to find where the menu is and copy its look. */
const ANCHOR_ROUTES = ['/schedules', '/reports', '/budget'];
const HOUSE_ICON =
  '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M10 2.2 1.6 9.1a.8.8 0 0 0 1 1.3l.9-.7V17c0 .6.4 1 1 1h4v-5h3v5h4c.6 0 1-.4 1-1V9.7l.9.7a.8.8 0 1 0 1-1.3L10 2.2Z"/></svg>';

declare global {
  interface Window {
    __actualMortgageTab?: { open(): void; close(): void };
  }
}

let warned = false;
function warnOnce(message: string, err?: unknown) {
  if (warned) return;
  warned = true;
  console.info(`${LOG} ${message}. Actual works normally; the Mortgage tab is hidden.`, err ?? '');
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** A visible sidebar link we can copy, preferring one that is not the active page. */
function findTemplateLink(): HTMLAnchorElement | null {
  const links: HTMLAnchorElement[] = [];
  for (const route of ANCHOR_ROUTES) {
    document.querySelectorAll<HTMLAnchorElement>(`a[href="${route}"]`).forEach((a) => {
      // The sidebar sits on the left; skip links elsewhere (e.g. in page content).
      if (!a.closest(`[${ITEM_ATTR}]`) && visible(a) && a.getBoundingClientRect().left < window.innerWidth / 3) links.push(a);
    });
    if (links.length) break;
  }
  return links.find((a) => a.getAttribute('aria-current') !== 'page') ?? links[0] ?? null;
}

/** The tall, narrow ancestor of a sidebar link: the sidebar itself. */
function findSidebar(link: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = link;
  while (el && el !== document.body) {
    const r = el.getBoundingClientRect();
    if (r.height >= window.innerHeight * 0.6 && r.width < Math.min(420, window.innerWidth * 0.5)) return el;
    el = el.parentElement;
  }
  return null;
}

function buildItem(template: HTMLAnchorElement): HTMLAnchorElement {
  const item = template.cloneNode(true) as HTMLAnchorElement;
  item.setAttribute(ITEM_ATTR, '');
  item.removeAttribute('aria-current');
  item.href = '#mortgage';
  item.title = 'Mortgage';

  // Replace the label: the deepest text node that has visible text.
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let label: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim()) label = n as Text;
  if (label) label.textContent = 'Mortgage';
  else item.append('Mortgage');

  // Swap the icon, keeping the size and classes Actual gave the original.
  const oldIcon = item.querySelector('svg');
  if (oldIcon) {
    const tpl = document.createElement('template');
    tpl.innerHTML = HOUSE_ICON;
    const icon = tpl.content.firstElementChild as SVGElement;
    for (const attr of ['class', 'style', 'width', 'height']) {
      const v = oldIcon.getAttribute(attr);
      if (v !== null) icon.setAttribute(attr, v);
    }
    oldIcon.replaceWith(icon);
  }
  return item;
}

function start() {
  let host: HTMLDivElement | null = null;
  let app: MountedApp | null = null;
  let item: HTMLAnchorElement | null = null;
  let openPath: string | null = null;
  let themeTimer = 0;
  const watchedSidebars = new WeakSet<HTMLElement>();

  const layout = () => {
    if (!host || !item) return;
    const sidebar = findSidebar(item);
    const left = sidebar ? Math.round(sidebar.getBoundingClientRect().right) : 0;
    Object.assign(host.style, { left: `${left}px`, top: '0px', right: '0px', bottom: '0px' });
  };

  const markActive = (active: boolean) => {
    if (!item) return;
    if (active) {
      item.setAttribute('aria-current', 'page');
      item.style.background = 'var(--color-sidebarItemBackgroundHover, rgba(255,255,255,0.08))';
      item.style.boxShadow = 'inset 3px 0 0 var(--color-sidebarItemAccentSelected, #8719e0)';
    } else {
      item.removeAttribute('aria-current');
      item.style.background = '';
      item.style.boxShadow = '';
    }
  };

  const open = () => {
    if (!host) {
      host = document.createElement('div');
      host.id = 'actual-mortgage-tab';
      Object.assign(host.style, { position: 'fixed', zIndex: '100', overflow: 'hidden' });
      document.body.appendChild(host);
      app = mountMortgageApp(host);
    }
    host.hidden = false;
    openPath = location.pathname;
    app?.syncTheme();
    layout();
    markActive(true);
    window.clearInterval(themeTimer);
    // Follow theme switches and leave when Actual navigates somewhere else.
    themeTimer = window.setInterval(() => {
      app?.syncTheme();
      if (location.pathname !== openPath) close();
    }, 800);
  };

  const close = () => {
    window.clearInterval(themeTimer);
    if (host) host.hidden = true;
    openPath = null;
    markActive(false);
  };

  const ensureItem = () => {
    if (item?.isConnected) return;
    const template = findTemplateLink();
    if (!template) return; // not logged in yet, a modal is up, or mobile layout
    item = buildItem(template);
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (openPath === null) open();
    });
    template.insertAdjacentElement('afterend', item);
    if (openPath !== null) markActive(true);

    // Any other sidebar link closes the mortgage screen.
    const sidebar = findSidebar(item);
    if (!sidebar || watchedSidebars.has(sidebar)) return;
    watchedSidebars.add(sidebar);
    sidebar.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element).closest?.('a, button');
        if (a && !a.hasAttribute(ITEM_ATTR) && openPath !== null) close();
      },
      true,
    );
  };

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try {
        ensureItem();
        if (openPath !== null) layout();
      } catch (err) {
        observer.disconnect();
        warnOnce('Stopped after an unexpected error', err);
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => openPath !== null && layout());
  ensureItem();

  window.__actualMortgageTab = { open, close };

  // Tell the user once if the sidebar never shows up after login.
  window.setTimeout(() => {
    if (!item && document.querySelector('a[href="/accounts"], a[href="/budget"]')) {
      warnOnce('Could not find a sidebar link to attach to');
    }
  }, 15_000);
}

function safeStart() {
  try {
    if (!window.__actualMortgageTab) start();
  } catch (err) {
    warnOnce('Failed to start', err);
  }
}

if (document.body) safeStart();
else document.addEventListener('DOMContentLoaded', safeStart, { once: true });
