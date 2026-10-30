import type { AssetKind } from '../engine/index.js';
import type { LoanType } from '../server/db.js';

/** How each loan type is named and what it usually pays for. */
export const LOAN_TYPE_INFO: Record<LoanType, { label: string; nickname: string; blurb: string; assetKind: AssetKind | null }> = {
  mortgage: {
    label: 'Mortgage',
    nickname: 'Mortgage',
    blurb: 'A home loan, with optional PMI and escrow. Equity is measured against the home.',
    assetKind: 'home',
  },
  auto: {
    label: 'Auto loan',
    nickname: 'Car loan',
    blurb: 'A car, truck or motorcycle loan. Equity is measured against the vehicle, which usually loses value.',
    assetKind: 'vehicle',
  },
  personal: {
    label: 'Personal loan',
    nickname: 'Personal loan',
    blurb: 'An installment loan with no asset behind it. Tracks the balance, interest and payoff.',
    assetKind: null,
  },
  student: {
    label: 'Student loan',
    nickname: 'Student loan',
    blurb: 'A federal or private student loan, with no asset behind it. Tracks the balance, interest and payoff.',
    assetKind: null,
  },
};

export const ASSET_KIND_LABEL: Record<AssetKind, string> = { home: 'Home', vehicle: 'Vehicle', other: 'Asset' };

/** The name of the screen that measures equity, by what the loan paid for. */
export function valueScreenLabel(kind: AssetKind | null | undefined): string {
  if (kind === 'home') return 'Equity';
  if (kind === 'vehicle') return 'Vehicle';
  if (kind === 'other') return 'Asset';
  return 'Totals';
}

/** Where value estimates usually come from, by asset kind. */
export const VALUE_SOURCES: Record<AssetKind, string[]> = {
  home: ['Appraisal', 'Tax assessment', 'Online estimate', 'Broker price opinion'],
  vehicle: ['Pricing guide', 'Dealer offer', 'Online estimate', 'Appraisal'],
  other: ['Appraisal', 'Online estimate', 'Offer'],
};

/** Inline 20x20 icons, as markup so the injected sidebar can use them too. */
export const TYPE_ICON_SVG: Record<LoanType, string> = {
  mortgage:
    '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M10 2.2 1.6 9.1a.8.8 0 0 0 1 1.3l.9-.7V17c0 .6.4 1 1 1h4v-5h3v5h4c.6 0 1-.4 1-1V9.7l.9.7a.8.8 0 1 0 1-1.3L10 2.2Z"/></svg>',
  auto:
    '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M5.3 4.5A2 2 0 0 1 7.1 3.4h5.8a2 2 0 0 1 1.8 1.1L16.3 8H17a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-.5v1.3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1.3h-7v1.3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1.3H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h.7l1.6-3.5ZM5.6 8h8.8l-1.2-2.7a.5.5 0 0 0-.4-.3H7.2a.5.5 0 0 0-.4.3L5.6 8Zm-.4 2.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm9.6 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>',
  personal:
    '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M3.5 5A2.5 2.5 0 0 1 6 2.5h8A2.5 2.5 0 0 1 16.5 5v.6A2.5 2.5 0 0 1 18 7.9v6.6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 2 14.5V7.5A2.5 2.5 0 0 1 3.5 5Zm1.5.5h9.5V5a.5.5 0 0 0-.5-.5H6a.5.5 0 0 0-.5.5v.5Zm9 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>',
  student:
    '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M9.6 2.6a1 1 0 0 1 .8 0l8.5 3.8a.6.6 0 0 1 0 1.1l-8.5 3.8a1 1 0 0 1-.8 0L3 8.4V12a.8.8 0 0 1-1.6 0V7.6a.6.6 0 0 1 .3-.5l7.9-4.5ZM5 10.6l4.6 2.1a1 1 0 0 0 .8 0l4.6-2.1V14c0 1.4-2.2 3-5 3s-5-1.6-5-3v-3.4Z"/></svg>',
};

/** The sidebar item's own icon: a stack of coins, neutral across loan types. */
export const TRACKER_ICON_SVG =
  '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M10 2c-3.9 0-7 1.3-7 3v2.5c0 1.7 3.1 3 7 3s7-1.3 7-3V5c0-1.7-3.1-3-7-3Zm0 1.8c3.1 0 5.2 1 5.2 1.2S13.1 6.2 10 6.2 4.8 5.2 4.8 5 6.9 3.8 10 3.8ZM3 10v2.5c0 1.7 3.1 3 7 3s7-1.3 7-3V10c-1.4 1-4 1.7-7 1.7S4.4 11 3 10Zm0 5v.5c0 1.7 3.1 3 7 3s7-1.3 7-3V15c-1.4 1-4 1.7-7 1.7S4.4 16 3 15Z"/></svg>';
