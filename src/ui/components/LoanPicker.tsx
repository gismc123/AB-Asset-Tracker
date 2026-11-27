import type { LoanListItem } from '../api.js';
import { TypeIcon } from './TypeIcon.js';

/** What's on screen: a loan, the add-loan wizard, backup and restore, or settings. */
export type PickerScreen = 'loan' | 'add' | 'backup' | 'settings';

interface Props {
  loans: LoanListItem[];
  selected: number | null;
  onSelect(loanId: number): void;
  onScreen(screen: PickerScreen): void;
  screen: PickerScreen;
}

/** Every active loan as a tab, plus the buttons that add one, open backups and open settings. Archived loans are left out. */
export function LoanPicker({ loans, selected, onSelect, onScreen, screen }: Props) {
  const active = loans.filter((l) => !l.loan.archived);
  return (
    <div className="mt-picker" role="tablist" aria-label="Loans">
      {active.map(({ loan }) => (
        <button
          key={loan.id}
          type="button"
          role="tab"
          className="mt-loan-tab"
          aria-selected={screen === 'loan' && loan.id === selected}
          onClick={() => onSelect(loan.id)}
          title={loan.nickname}
        >
          <TypeIcon type={loan.type} />
          <span>{loan.nickname}</span>
        </button>
      ))}
      <button type="button" className="mt-loan-tab add" aria-selected={screen === 'add'} onClick={() => onScreen('add')}>
        + Add loan
      </button>
      <button type="button" className="mt-loan-tab" aria-selected={screen === 'backup'} onClick={() => onScreen('backup')} title="Backup and restore">
        Backup
      </button>
      <button type="button" className="mt-loan-tab" aria-selected={screen === 'settings'} onClick={() => onScreen('settings')} title="Version, privacy and terms">
        Settings
      </button>
    </div>
  );
}
