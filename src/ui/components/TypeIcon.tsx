import type { LoanType } from '../api.js';
import { TYPE_ICON_SVG } from '../loanTypes.js';

export function TypeIcon({ type }: { type: LoanType }) {
  return <span className="mt-type-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: TYPE_ICON_SVG[type] }} />;
}
