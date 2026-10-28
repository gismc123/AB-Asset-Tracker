import type { Cents, ISODate } from './types.js';

/** What a loan pays for, if anything: the thing whose value makes up equity. */
export type AssetKind = 'home' | 'vehicle' | 'other';

/**
 * How the asset's value is expected to move between value entries.
 * `manual` means only the values you enter count; the other two add a
 * projected curve at `trendRatePercent` a year, always labeled as an estimate.
 */
export type ValueTrend = 'appreciating' | 'depreciating' | 'manual';

/** A value on a date: an appraisal, a tax assessment, a pricing guide, an online estimate. */
export interface AssetValue {
  date: ISODate;
  value: Cents;
  source: string;
}

export interface Asset {
  name: string;
  kind: AssetKind;
  /** Purchase price or value when acquired. Equity uses it until a value is entered. */
  originalValue: Cents;
  valueTrend: ValueTrend;
  /** Yearly percent for the projected curve. Ignored for `manual`. */
  trendRatePercent: number | null;
  /** When the asset was bought; the projected curve starts here when no value is entered. */
  acquiredDate: ISODate | null;
  values: readonly AssetValue[];
}

export const ASSET_KINDS: AssetKind[] = ['home', 'vehicle', 'other'];
export const VALUE_TRENDS: ValueTrend[] = ['appreciating', 'depreciating', 'manual'];

/** The latest value by date (later entries win ties). */
export function latestValue(values: readonly AssetValue[]): AssetValue | null {
  let best: AssetValue | null = null;
  for (const v of values) if (!best || v.date >= best.date) best = v;
  return best;
}
