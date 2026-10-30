import { useState } from 'react';
import type { BalanceCheck } from '../../engine/index.js';
import type { BudgetAccount, LoanClient, StateView } from '../api.js';
import { date } from '../format.js';
import { Amt } from './Amt.js';

/** One line on the Overview: does the tracker's balance match the linked Actual account's? */
export function BalanceCheckNote({ check }: { check: BalanceCheck }) {
  const name = <b>{check.account.name ?? 'the linked account'}</b>;
  if (check.actual === null) {
    return (
      <div className="mt-note warn" style={{ marginBottom: 14 }}>
        Couldn't compare with your Actual account {name}: {check.problem}
      </div>
    );
  }
  return (
    <div className={`mt-note ${check.matches ? 'good' : 'warn'}`} style={{ marginBottom: 14 }}>
      {check.matches ? (
        <>Balance matches your Actual account {name} (<Amt cents={check.actual} />).</>
      ) : (
        <>
          Balance differs from your Actual account {name} by <Amt cents={Math.abs(check.difference!)} />: the tracker has{' '}
          <Amt cents={check.tracker} />, Actual <Amt cents={check.actual} /> as of {date(check.account.asOf)}. Usually a payment
          that's reconciled here but not yet split in Actual, or the other way round.
        </>
      )}
      {check.problem && <> {check.problem} This is the balance read earlier.</>}
    </div>
  );
}

/** Setup: pick an Actual account that tracks this loan's balance, to compare with. Off by default. */
export function BalanceCheckSettings({ state, client, onState }: { state: StateView; client: LoanClient; onState(state: StateView): void }) {
  const current = state.settings.balanceAccountId;
  const [accounts, setAccounts] = useState<BudgetAccount[] | null>(null);
  const [choice, setChoice] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setAccounts(await client.accounts());
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async (accountId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      onState(await client.setBalanceAccount(state.settings.categoryId, accountId));
      setAccounts(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Off-budget accounts first: that's where a loan's balance is usually kept.
  const listed = (accounts ?? []).filter((a) => !a.closed || a.id === current).sort((a, b) => Number(b.offBudget) - Number(a.offBudget) || a.name.localeCompare(b.name));

  return (
    <div className="mt-card">
      <h3>Cross-check with Actual (optional)</h3>
      <p style={{ marginTop: 0 }}>
        Already keep this loan's balance in an account in Actual? Link it, and the Overview says whether it matches the tracker.
        Read only: the account is never changed.
      </p>
      {current && !accounts && (
        <div className="mt-row">
          <span>
            Comparing with <b>{state.balanceCheck?.account.name ?? 'an Actual account'}</b>.
          </span>
          <button type="button" className="mt-btn link" onClick={load}>
            Change
          </button>
          <button type="button" className="mt-btn link" disabled={busy} onClick={() => save(null)}>
            Stop comparing
          </button>
        </div>
      )}
      {!current && !accounts && (
        <button type="button" className="mt-btn small" onClick={load}>
          Pick an account
        </button>
      )}
      {accounts && (
        <div className="mt-inline-form">
          <div className="mt-field">
            <label htmlFor="mt-balance-account">Actual account with this loan's balance</label>
            <select id="mt-balance-account" className="mt-select" style={{ width: '100%', minWidth: 0 }} value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose an account…</option>
              {listed.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.offBudget ? ' (off budget)' : ''}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="mt-btn primary" disabled={busy || !choice} onClick={() => save(choice)}>
            Compare
          </button>
          <button type="button" className="mt-btn link" onClick={() => setAccounts(null)}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <div className="mt-note bad" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
