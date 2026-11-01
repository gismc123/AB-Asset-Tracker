import { useState } from 'react';
import type { LoanClient, StateView } from '../api.js';
import { date } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  state: StateView;
  client: LoanClient;
  onState(state: StateView): void;
}

/**
 * Reconciled months keep the amounts locked when they were matched. When
 * today's setup or math would split them differently, offer to work them out
 * again: what was paid stays what the bank shows.
 */
export function RecalculateNotice({ state, client, onState }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = state.recalculation;
  if (!r) return null;

  const n = r.changes.length;
  const months = `${n} reconciled month${n === 1 ? '' : 's'}`;
  const recalculate = async () => {
    setBusy(true);
    setError(null);
    try {
      onState(await client.recalculate());
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-note warn" style={{ marginBottom: 14 }}>
      <div className="mt-row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span>
          {n > 0 ? (
            <>
              {months} still {n === 1 ? 'has' : 'have'} the amounts locked when {n === 1 ? 'it was' : 'they were'} matched, worked out with
              earlier settings. Recalculated, your balance would be <b><Amt cents={r.balance.after} /></b> instead of{' '}
              <Amt cents={r.balance.before} />.
            </>
          ) : (
            <>Some reconciled months can't be worked out with the current settings.</>
          )}
        </span>
        <button type="button" className="mt-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Review'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          {n > 0 && (
            <table className="mt-data">
              <thead>
                <tr>
                  <th className="l">Payment</th>
                  <th>Interest</th>
                  <th>Principal</th>
                  <th>Balance after</th>
                </tr>
              </thead>
              <tbody>
                {r.changes.map((c) => (
                  <tr key={c.payment}>
                    <td className="l">
                      #{c.payment} · {date(c.dueDate)}
                      {c.difference !== 0 && (
                        <div className="mt-kpi-note">
                          You paid <Amt cents={Math.abs(c.difference)} /> {c.difference > 0 ? 'more' : 'less'} than the settings now expect: that
                          goes to principal.
                        </div>
                      )}
                    </td>
                    <Change before={c.before.interest} after={c.after.interest} />
                    <Change before={c.before.principal} after={c.after.principal} />
                    <Change before={c.before.endingBalance} after={c.after.endingBalance} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r.problems.map((p) => (
            <div key={p.payment} className="mt-note bad" style={{ marginTop: 10 }}>
              {p.message}
            </div>
          ))}
          <p style={{ margin: '12px 0' }}>
            What you paid stays what your bank shows. Only how each payment splits between interest and principal is worked out again,
            in order, so each month starts from the balance the one before leaves. Want a way back? Make a backup first.
          </p>
          {error && (
            <div className="mt-note bad" style={{ marginBottom: 10 }} role="alert">
              {error}
            </div>
          )}
          <button type="button" className="mt-btn primary" disabled={busy || r.problems.length > 0} onClick={recalculate}>
            Recalculate {months}
          </button>
        </div>
      )}
    </div>
  );
}

function Change({ before, after }: { before: number; after: number }) {
  return (
    <td>
      {before === after ? (
        <Amt cents={after} />
      ) : (
        <>
          <span style={{ color: 'var(--muted)', textDecoration: 'line-through' }}>
            <Amt cents={before} />
          </span>{' '}
          <Amt cents={after} />
        </>
      )}
    </td>
  );
}
