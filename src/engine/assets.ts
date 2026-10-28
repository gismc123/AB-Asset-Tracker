import { daysBetween } from './dates.js';
import type { Cents, ISODate, LoanSetup } from './types.js';

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

/** A home bought with the loan, valued at the setup's original home value. What every loan was before assets existed. */
export function homeAssetFor(setup: LoanSetup, values: readonly AssetValue[] = []): Asset {
  return {
    name: 'Home',
    kind: 'home',
    originalValue: setup.originalHomeValue,
    valueTrend: 'manual',
    trendRatePercent: null,
    acquiredDate: setup.openDate,
    values,
  };
}

/** The value equity is measured against: the latest entry, or the original value. */
export function currentValue(asset: Asset): { value: Cents; date: ISODate | null; source: string; entered: boolean } {
  const latest = latestValue(asset.values);
  return latest
    ? { value: latest.value, date: latest.date, source: latest.source, entered: true }
    : { value: asset.originalValue, date: asset.acquiredDate, source: 'Original value', entered: false };
}

/** True when the asset has a projected curve: a trend with a yearly rate. */
export const hasProjection = (asset: Asset) =>
  asset.valueTrend !== 'manual' && typeof asset.trendRatePercent === 'number' && asset.trendRatePercent > 0;

/**
 * The projected value on `date`: the latest value entered on or before
 * that date (or the original value from when it was acquired), moved by the
 * yearly trend rate, compounded by the day. Without a trend this is just
 * that value. Always an estimate.
 */
export function projectedValue(asset: Asset, date: ISODate, fallbackStart: ISODate): Cents {
  let base: { date: ISODate; value: Cents } = { date: asset.acquiredDate ?? fallbackStart, value: asset.originalValue };
  for (const v of asset.values) if (v.date <= date && v.date >= base.date) base = v;
  if (!hasProjection(asset)) return base.value;
  const years = Math.max(0, daysBetween(base.date, date)) / 365.25;
  const rate = (asset.trendRatePercent! / 100) * (asset.valueTrend === 'depreciating' ? -1 : 1);
  return Math.max(0, Math.round(base.value * Math.pow(1 + rate, years)));
}
