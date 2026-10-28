import { useEffect, useState } from 'react';
import type { LoanRecord } from '../api.js';

interface Props {
  loan: LoanRecord;
  onRename(nickname: string): Promise<void>;
  onArchive(archived: boolean): Promise<void>;
  onDelete(): Promise<void>;
}

/** Name, archive and delete. Shown at the bottom of Setup. */
export function LoanSettings({ loan, onRename, onArchive, onDelete }: Props) {
  const [name, setName] = useState(loan.nickname);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(loan.nickname), [loan.nickname]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-card">
      <h3>This loan</h3>
      <form
        className="mt-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => onRename(name.trim()));
        }}
      >
        <div className="mt-field">
          <label htmlFor="mt-loan-name">Nickname</label>
          <input id="mt-loan-name" className="mt-input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="mt-btn" disabled={busy || !name.trim() || name.trim() === loan.nickname}>
          Rename
        </button>
      </form>
      <div className="mt-gap" />
      <div className="mt-row">
        <button type="button" className="mt-btn" disabled={busy} onClick={() => run(() => onArchive(!loan.archived))}>
          {loan.archived ? 'Unarchive' : 'Archive'}
        </button>
        <span className="mt-kpi-note">
          {loan.archived ? 'Archived loans are hidden from the picker, the sidebar and the summary.' : 'Paid off or sold? Archive it to hide it and keep its history.'}
        </span>
      </div>
      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--bad)' }}>Delete this loan</summary>
        <p>
          This removes the loan and everything recorded for it: setup, reconciled months, skips, escrow entries, details, and
          its {`asset's`} value history. It can't be undone. Your budget in Actual isn't touched.
        </p>
        <div className="mt-inline-form">
          <div className="mt-field">
            <label htmlFor="mt-delete-confirm">Type “{loan.nickname}” to confirm</label>
            <input id="mt-delete-confirm" className="mt-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button type="button" className="mt-btn danger" disabled={busy || confirm !== loan.nickname} onClick={() => run(onDelete)}>
            Delete loan
          </button>
        </div>
      </details>
      {error && (
        <div className="mt-note bad" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
