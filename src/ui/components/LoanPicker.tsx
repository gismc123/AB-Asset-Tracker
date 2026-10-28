import type { LoanListItem } from '../api.js';
import { TypeIcon } from './TypeIcon.js';

interface Props {
  loans: LoanListItem[];
  selected: number | null;
  onSelect(loanId: number): void;
  onAdd(): void;
  adding: boolean;
}

/** Every active loan as a tab, plus the button that adds one. Archived loans are left out. */
export function LoanPicker({ loans, selected, onSelect, onAdd, adding }: Props) {
  const active = loans.filter((l) => !l.loan.archived);
  return (
    <div className="mt-picker" role="tablist" aria-label="Loans">
      {active.map(({ loan }) => (
        <button
          key={loan.id}
          type="button"
          role="tab"
          className="mt-loan-tab"
          aria-selected={!adding && loan.id === selected}
          onClick={() => onSelect(loan.id)}
          title={loan.nickname}
        >
          <TypeIcon type={loan.type} />
          <span>{loan.nickname}</span>
        </button>
      ))}
      <button type="button" className="mt-loan-tab add" aria-selected={adding} onClick={onAdd}>
        + Add loan
      </button>
    </div>
  );
}
