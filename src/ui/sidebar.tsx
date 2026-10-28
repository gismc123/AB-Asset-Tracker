import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LoanListItem, TrackerClient } from './api.js';
import { money } from './format.js';
import { TYPE_ICON_SVG } from './loanTypes.js';
import { hasRedactedFont } from './mount.js';

/**
 * Styles for the sidebar list. Colors come from Actual's sidebar variables
 * (which cross the shadow boundary), so it matches the light and dark themes.
 */
const SIDEBAR_STYLES = /* css */ `
:host { all: initial; display: block; }
.sl {
  --text: var(--color-sidebarItemText, #e8e9ee);
  --muted: var(--color-sidebarItemText, #9a9cab);
  --hover: var(--color-sidebarItemBackgroundHover, rgba(255, 255, 255, 0.08));
  --accent: var(--color-sidebarItemAccentSelected, #8719e0);
  --neg: var(--color-errorText, #ff8a85);
  font: 13px/1.35 var(--font-family, 'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  font-feature-settings: 'tnum' 1;
  color: var(--text);
  padding: 2px 0 6px;
}
.sl-row {
  display: grid; grid-template-columns: 16px 1fr auto; gap: 2px 8px; align-items: center;
  width: 100%; border: 0; background: none; color: inherit; font: inherit; text-align: left;
  padding: 5px 14px 5px 22px; cursor: pointer; border-left: 3px solid transparent;
}
.sl-row:hover { background: var(--hover); }
.sl-row[aria-current='true'] { border-left-color: var(--accent); background: var(--hover); }
.sl-icon { display: flex; opacity: 0.8; grid-row: span 2; align-self: start; padding-top: 1px; }
.sl-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl-equity { font-weight: 600; white-space: nowrap; }
.sl-equity.neg { color: var(--neg); }
.sl-owed { grid-column: 2 / 4; font-size: 11px; opacity: 0.65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sl.privacy.redact .sl-amt:not(:hover) { font-family: 'Redacted Script', var(--font-family, sans-serif); }
.sl.privacy:not(.redact) .sl-amt:not(:hover) { filter: blur(4px); }
`;

interface Props {
  client: TrackerClient;
  onOpen(loanId: number): void;
  current: number | null;
  /** Lets the host ask for a reload after the loans change. */
  bindRefresh(refresh: () => void): void;
}

/** Each active loan: equity as the headline, what's owed underneath. Click to open it. */
export function SidebarLoans({ client, onOpen, current, bindRefresh }: Props) {
  const [loans, setLoans] = useState<LoanListItem[]>([]);

  const refresh = useCallback(() => {
    client.loans().then(
      (list) => setLoans(list.filter((l) => !l.loan.archived)),
      // Not logged in yet, or the backend is down: show nothing, Actual works as usual.
      () => setLoans([]),
    );
  }, [client]);

  useEffect(() => {
    refresh();
    bindRefresh(refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, bindRefresh]);

  if (!loans.length) return null;
  return (
    <div role="list" aria-label="Loans">
      {loans.map(({ loan, equity, owed, asset, configured }) => (
        <button
          key={loan.id}
          type="button"
          role="listitem"
          className="sl-row"
          aria-current={loan.id === current}
          title={loan.nickname}
          onClick={() => onOpen(loan.id)}
        >
          <span className="sl-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: TYPE_ICON_SVG[loan.type] }} />
          <span className="sl-name">{loan.nickname}</span>
          <span className={`sl-equity ${equity !== null && equity < 0 ? 'neg' : ''}`}>
            {equity !== null && <span className="sl-amt">{money(equity, { whole: true })}</span>}
          </span>
          <span className="sl-owed">
            {!configured ? (
              'Not set up yet'
            ) : owed !== null ? (
              <>
                owe <span className="sl-amt">{money(owed, { whole: true })}</span>
                {!asset && ' · no asset'}
              </>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

export interface MountedSidebar {
  refresh(): void;
  setPrivacy(on: boolean): void;
  setCurrent(loanId: number | null): void;
  unmount(): void;
}

/** Render the sidebar list into `host`, in its own shadow root. */
export function mountSidebarLoans(host: HTMLElement, client: TrackerClient, onOpen: (loanId: number) => void): MountedSidebar {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = SIDEBAR_STYLES;
  const container = document.createElement('div');
  container.className = 'sl';
  shadow.append(style, container);

  const root = createRoot(container);
  let refreshList = () => {};
  let current: number | null = null;
  const bindRefresh = (fn: () => void) => {
    refreshList = fn;
  };
  const render = () => root.render(<SidebarLoans client={client} onOpen={onOpen} current={current} bindRefresh={bindRefresh} />);
  render();
  return {
    refresh: () => refreshList(),
    setPrivacy(on) {
      container.classList.toggle('privacy', on);
      container.classList.toggle('redact', on && hasRedactedFont());
    },
    setCurrent(loanId) {
      if (loanId === current) return;
      current = loanId;
      render();
    },
    unmount() {
      root.unmount();
      shadow.innerHTML = '';
    },
  };
}
