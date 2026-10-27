import { money } from '../format.js';

/**
 * A dollar amount. Wrapped in its own element so Actual's privacy mode can
 * blur it (see `.mt.privacy .mt-amt` in styles.ts).
 */
export function Amt({ cents, whole, sign }: { cents: number; whole?: boolean; sign?: boolean }) {
  return <span className="mt-amt">{money(cents, { whole, sign })}</span>;
}
