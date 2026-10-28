/**
 * The one script the proxy injects into Actual's page.
 *
 * It adds a "Loans" item to Actual's sidebar, with each loan listed under
 * it, and when clicked shows the loan screens in the content area next to
 * the sidebar. Everything here is defensive: if Actual's markup changes and
 * the sidebar can't be found, the script does nothing and Actual keeps
 * working exactly as before.
 */
import { createClient } from '../ui/api.js';
import { TRACKER_ICON_SVG } from '../ui/loanTypes.js';
import { mountTrackerApp, type MountedApp } from '../ui/mount.js';
import { mountSidebarLoans, type MountedSidebar } from '../ui/sidebar.js';

const LOG = '[asset-tracker]';
const ITEM_ATTR = 'data-asset-tracker';
const LIST_ATTR = 'data-asset-tracker-list';
const LABEL = 'Loans';
/** Sidebar links we try, in order, to find where the menu is and copy its look. */
const ANCHOR_ROUTES = ['/schedules', '/reports', '/budget'];

declare global {
  interface Window {
    __abAssetTracker?: { open(loanId?: number): void; close(): void };
  }
}

let warned = false;
function warnOnce(message: string, err?: unknown) {
  if (warned) return;
  warned = true;
  console.info(`${LOG} ${message}. Actual works normally; the Loans item is hidden.`, err ?? '');
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Visible sidebar links: `anchor` is the one to insert after, `template` the
 * one to copy, which must not be the current page or Loans would look
 * selected too.
 */
function findSidebarLinks(): { anchor: HTMLAnchorElement; template: HTMLAnchorElement } | null {
  const links: HTMLAnchorElement[] = [];
  for (const route of ANCHOR_ROUTES) {
    document.querySelectorAll<HTMLAnchorElement>(`a[href="${route}"]`).forEach((a) => {
      // The sidebar sits on the left; skip links elsewhere (e.g. in page content).
      if (!a.closest(`[${ITEM_ATTR}], [${LIST_ATTR}]`) && visible(a) && a.getBoundingClientRect().left < window.innerWidth / 3) links.push(a);
    });
  }
  const anchor = links[0];
  if (!anchor) return null;
  return { anchor, template: links.find((a) => a.getAttribute('aria-current') !== 'page') ?? anchor };
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

/**
 * Actual's top bar (sync status, notifications, help) to the right of the
 * sidebar: the outermost short, wide element at the top of the window.
 */
function findTitlebar(left: number): HTMLElement | null {
  let el = document.elementFromPoint(window.innerWidth - 24, 6) as HTMLElement | null;
  let bar: HTMLElement | null = null;
  while (el && el !== document.body) {
    const r = el.getBoundingClientRect();
    if (r.height >= 120) break;
    if (r.top <= 1 && r.width >= (window.innerWidth - left) * 0.5) bar = el;
    el = el.parentElement;
  }
  return bar;
}

/**
 * The top bar's page-specific part: everything before its flexible spacer
 * (e.g. the Budget page's month-count picker). The global controls after the
 * spacer stay. A sidebar/menu toggle is kept wherever it is.
 */
function pageSpecificTitlebarParts(bar: HTMLElement): HTMLElement[] {
  const parts: HTMLElement[] = [];
  for (const child of Array.from(bar.children) as HTMLElement[]) {
    if (Number.parseFloat(getComputedStyle(child).flexGrow) >= 1) return parts;
    const keep = Array.from(child.querySelectorAll('[aria-label]')).some((e) => /sidebar|menu/i.test(e.getAttribute('aria-label') ?? ''));
    if (!keep) parts.push(child);
  }
  return []; // no spacer found: the layout isn't what we expect, so touch nothing
}

/**
 * Actual's privacy mode, read from its top bar button ("Enable privacy mode"
 * / "Disable privacy mode"). Null when the button can't be found.
 */
function actualPrivacyEnabled(): boolean | null {
  const button = document.querySelector('button[aria-label*="privacy" i]');
  return button ? /disable/i.test(button.getAttribute('aria-label') ?? '') : null;
}

function buildItem(template: HTMLAnchorElement): HTMLAnchorElement {
  const item = template.cloneNode(true) as HTMLAnchorElement;
  item.setAttribute(ITEM_ATTR, '');
  item.removeAttribute('aria-current');
  item.href = HASH;
  item.title = LABEL;

  // Replace the label: the deepest text node that has visible text.
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let label: Text | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent?.trim()) label = n as Text;
  if (label) label.textContent = LABEL;
  else item.append(LABEL);

  // Swap the icon, keeping the size and classes Actual gave the original.
  const oldIcon = item.querySelector('svg');
  if (oldIcon) {
    const tpl = document.createElement('template');
    tpl.innerHTML = TRACKER_ICON_SVG;
    const icon = tpl.content.firstElementChild as SVGElement;
    for (const attr of ['class', 'style', 'width', 'height']) {
      const v = oldIcon.getAttribute(attr);
      if (v !== null) icon.setAttribute(attr, v);
    }
    oldIcon.replaceWith(icon);
  }
  return item;
}

// The URL carries #loans while the screen is open, as its own history
// entry, so Back closes it and reload or a bookmark reopens it.
const HASH = '#loans';

function start() {
  const client = createClient();
  let host: HTMLDivElement | null = null;
  let app: MountedApp | null = null;
  let item: HTMLAnchorElement | null = null;
  let listHost: HTMLDivElement | null = null;
  let list: MountedSidebar | null = null;
  let openPath: string | null = null;
  let themeTimer = 0;

  // Page-specific top bar controls hidden while the loans screen is open.
  const hiddenParts = new Set<HTMLElement>();
  const showTitlebarParts = () => {
    for (const el of hiddenParts) el.style.visibility = '';
    hiddenParts.clear();
  };

  const layout = () => {
    if (!host || !item) return;
    const sidebar = findSidebar(item);
    const left = sidebar ? Math.round(sidebar.getBoundingClientRect().right) : 0;
    // Hidden elements aren't hit-tested, so measure Actual's top bar under us.
    host.style.visibility = 'hidden';
    const bar = findTitlebar(left);
    host.style.visibility = '';
    // Cover the whole content area, including the strip behind Actual's
    // see-through top bar (pages draw there too), and start our content
    // below the bar. The bar itself stays on top and usable.
    const top = bar ? Math.round(bar.getBoundingClientRect().bottom) : 0;
    Object.assign(host.style, { left: `${left}px`, top: '0px', right: '0px', bottom: '0px' });
    host.style.setProperty('--mt-top', `${top}px`);
    if (bar) {
      for (const el of pageSpecificTitlebarParts(bar)) {
        if (hiddenParts.has(el)) continue;
        el.style.visibility = 'hidden';
        hiddenParts.add(el);
      }
    }
  };

  const syncPrivacy = () => {
    const on = actualPrivacyEnabled() ?? false;
    app?.setPrivacy(on);
    list?.setPrivacy(on);
  };

  // While the loans screen is open, the sidebar should show Loans as the
  // current page, not the page underneath. Actual styles its current link
  // with one class, so swap classes with that link and swap back on close.
  let itemClass = '';
  let demoted: { link: HTMLAnchorElement; className: string } | null = null;

  const restoreDemoted = () => {
    if (!demoted) return;
    // After Back/Forward the page may have changed under us; then Actual has
    // moved on and the link should stay unselected.
    if (demoted.link.pathname === location.pathname) {
      demoted.link.className = demoted.className;
      demoted.link.setAttribute('aria-current', 'page');
    }
    demoted = null;
  };

  const markActive = (active: boolean) => {
    if (!item) return;
    if (!active) {
      restoreDemoted();
      item.className = itemClass;
      item.removeAttribute('aria-current');
      item.style.background = '';
      item.style.boxShadow = '';
      return;
    }
    item.setAttribute('aria-current', 'page');
    const sidebar = findSidebar(item);
    const current = sidebar?.querySelector<HTMLAnchorElement>(`a[aria-current="page"]:not([${ITEM_ATTR}])`);
    if (current && current !== demoted?.link) {
      restoreDemoted();
      demoted = { link: current, className: current.className };
    }
    if (demoted) {
      // Re-applied on every call in case Actual re-rendered the link.
      demoted.link.className = itemClass;
      demoted.link.removeAttribute('aria-current');
      item.className = demoted.className;
    } else {
      // No current link to borrow from: approximate Actual's look.
      item.style.background = 'var(--color-sidebarItemBackgroundHover, rgba(255,255,255,0.08))';
      item.style.boxShadow = 'inset 3px 0 0 var(--color-sidebarItemAccentSelected, #8719e0)';
    }
  };

  const pushHash = () => {
    if (location.hash !== HASH) history.pushState(history.state, '', `${location.pathname}${location.search}${HASH}`);
  };

  const open = (loanId?: number) => {
    if (!host) {
      host = document.createElement('div');
      host.id = 'ab-asset-tracker';
      // Above page content (Schedules' sticky header is 200), below Actual's
      // own chrome, menus and notifications (501 and up).
      Object.assign(host.style, {
        position: 'fixed',
        zIndex: '500',
        overflow: 'hidden',
        background: 'var(--color-pageBackground, #f4f5f8)',
      });
      document.body.appendChild(host);
      app = mountTrackerApp(host, {
        client,
        initialLoan: loanId ?? null,
        onChange: () => list?.refresh(),
        onSelect: (id) => list?.setCurrent(openPath === null ? null : id),
      });
    } else if (loanId !== undefined) app?.selectLoan(loanId);
    // Not the `hidden` attribute: Actual's CSS overrides its display:none.
    host.style.display = 'block';
    pushHash();
    openPath = location.pathname;
    app?.syncTheme();
    syncPrivacy();
    layout();
    markActive(true);
    window.clearInterval(themeTimer);
    // Follow theme switches and leave when Actual navigates somewhere else.
    themeTimer = window.setInterval(() => {
      app?.syncTheme();
      syncPrivacy();
      if (location.pathname !== openPath) close();
    }, 800);
  };

  /** `dropHash` when nothing else is changing the URL (Actual's own links do). */
  const close = ({ dropHash = false } = {}) => {
    window.clearInterval(themeTimer);
    if (host) host.style.display = 'none';
    list?.setCurrent(null);
    showTitlebarParts();
    openPath = null;
    markActive(false);
    if (dropHash && location.hash === HASH) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  };

  // Back and Forward across the #loans entry.
  window.addEventListener('popstate', () => {
    if (location.hash === HASH && openPath === null && item) open();
    else if (location.hash !== HASH && openPath !== null) close();
  });

  /** The loans listed under the sidebar item, like Actual lists accounts. */
  const ensureList = () => {
    if (!item?.isConnected || (listHost?.isConnected && listHost.previousElementSibling === item)) return;
    if (!listHost) {
      listHost = document.createElement('div');
      listHost.setAttribute(LIST_ATTR, '');
      list = mountSidebarLoans(listHost, client, (loanId) => open(loanId));
      syncPrivacy();
    }
    item.insertAdjacentElement('afterend', listHost);
  };

  const ensureItem = () => {
    ensureList();
    if (item?.isConnected) return;
    const found = findSidebarLinks();
    if (!found) return; // not logged in yet, a modal is up, or mobile layout
    item = buildItem(found.template);
    itemClass = item.className;
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (openPath === null) open();
    });
    found.anchor.insertAdjacentElement('afterend', item);
    ensureList();
    if (openPath !== null) markActive(true);
    // Reloaded or bookmarked with the screen open.
    else if (location.hash === HASH) open();
  };

  // Following any of Actual's links (sidebar, top bar) leaves the loans
  // screen. Clicks inside it are retargeted to `host`, so they don't count.
  document.addEventListener(
    'click',
    (e) => {
      if (!(e.target instanceof Element)) return;
      // Follow Actual's privacy toggle right away rather than on the next tick.
      // Actual relabels the button once it has saved the setting, so check a few times.
      if (e.target.closest('button[aria-label*="privacy" i]')) for (const ms of [50, 300, 1000]) window.setTimeout(syncPrivacy, ms);
      if (openPath === null || host?.contains(e.target) || listHost?.contains(e.target)) return;
      const link = e.target.closest('a[href]');
      if (link && !link.hasAttribute(ITEM_ATTR)) close();
    },
    true,
  );

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      try {
        ensureItem();
        if (openPath !== null) {
          layout();
          markActive(true);
        }
      } catch (err) {
        observer.disconnect();
        warnOnce('Stopped after an unexpected error', err);
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => openPath !== null && layout());
  ensureItem();

  window.__abAssetTracker = { open, close: () => close({ dropHash: true }) };

  // Tell the user once if the sidebar never shows up after login.
  window.setTimeout(() => {
    if (!item && document.querySelector('a[href="/accounts"], a[href="/budget"]')) {
      warnOnce('Could not find a sidebar link to attach to');
    }
  }, 15_000);
}

function safeStart() {
  try {
    if (!window.__abAssetTracker) start();
  } catch (err) {
    warnOnce('Failed to start', err);
  }
}

if (document.body) safeStart();
else document.addEventListener('DOMContentLoaded', safeStart, { once: true });
