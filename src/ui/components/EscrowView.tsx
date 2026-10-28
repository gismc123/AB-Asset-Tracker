import { useState } from 'react';
import { ESCROW_KINDS, type EscrowKind, type EscrowYear } from '../../engine/index.js';
import type { LoanClient, StateView } from '../api.js';
import { date, parseDollars } from '../format.js';
import { Amt } from './Amt.js';
import { TrendChart } from './TrendChart.js';

interface Props {
  state: StateView;
  client: LoanClient;
  onState(state: StateView): void;
}

/** Columns for the by-year table; insurance kinds are combined. */
const YEAR_COLUMNS: { label: string; kinds: EscrowKind[] }[] = [
  { label: 'Property tax', kinds: ['propertyTax'] },
  { label: 'Insurance', kinds: ['homeownersInsurance', 'floodInsurance'] },
  { label: 'Other', kinds: ['hoa', 'otherDisbursement'] },
  { label: 'Refunds', kinds: ['refund'] },
];
const yearSum = (y: EscrowYear, kinds: EscrowKind[]) => kinds.reduce((s, k) => s + (y.paidOut[k] ?? 0), 0);

/**
 * The escrow account: what comes in with each payment, the tax and insurance
 * bills the servicer pays out of it, and the running balance.
 */
export function EscrowView({ state, client, onState }: Props) {
  const esc = state.analysis!.escrow;
  const [d, setD] = useState({ kind: 'propertyTax' as EscrowKind, date: state.today, amount: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<StateView>) => {
    setBusy(true);
    setError(null);
    try {
      onState(await fn());
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const cents = parseDollars(d.amount);
    if (!cents || cents <= 0) return setError('Enter the amount, like 1,842.17');
    if (await run(() => client.addEscrowEntry({ kind: d.kind, date: d.date, amount: cents, note: d.note.trim() }))) {
      setD((p) => ({ ...p, amount: '', note: '' }));
    }
  };

  const hasBills = esc.billsLast12 > 0;
  const lines = [...esc.lines].reverse();

  return (
    <div>
      <div className="mt-grid mt-kpis">
        <div className="mt-card">
          <div className="mt-kpi-label">Escrow balance</div>
          <div className="mt-kpi-value" style={esc.balance < 0 ? { color: 'var(--bad)' } : undefined}>
            <Amt cents={esc.balance} />
          </div>
          <div className="mt-kpi-note">
            {esc.balance < 0
              ? 'Short: the servicer covered the difference'
              : esc.lines.length
                ? `As of ${date(esc.lines.at(-1)!.date)}`
                : 'Nothing recorded yet'}
          </div>
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">Monthly escrow</div>
          <div className="mt-kpi-value">
            <Amt cents={esc.monthly} />
          </div>
          <div className="mt-kpi-note">
            <Amt cents={esc.annualCollection} /> a year
          </div>
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">Bills, last 12 months</div>
          <div className="mt-kpi-value">
            <Amt cents={esc.billsLast12} />
          </div>
          <div className="mt-kpi-note">Taxes and insurance paid from escrow</div>
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">Yearly cushion</div>
          <div className="mt-kpi-value" style={hasBills && esc.cushion < 0 ? { color: 'var(--warn)' } : undefined}>
            {hasBills ? <Amt cents={esc.cushion} sign /> : '—'}
          </div>
          <div className="mt-kpi-note">
            {!hasBills
              ? 'Record a bill to compare'
              : esc.cushion < 0
                ? 'Collecting less than the bills: expect a higher escrow payment'
                : 'Collecting more than the last year of bills'}
          </div>
        </div>
      </div>

      <div className="mt-gap" />
      <div className="mt-grid mt-two">
        <div className="mt-card">
          <h3>Escrow balance over time</h3>
          {esc.lines.length > 1 ? (
            <TrendChart
              step
              label="Escrow account balance"
              points={esc.lines.map((l) => ({ date: l.date, value: l.balance, note: l.note || l.label }))}
            />
          ) : (
            <div className="mt-empty">The chart starts once there are a couple of entries.</div>
          )}
        </div>
        <div className="mt-card">
          <h3>Record a bill or deposit</h3>
          <form onSubmit={add} style={{ display: 'grid', gap: 10 }}>
            <div className="mt-field">
              <label htmlFor="mt-esc-kind">What</label>
              <select id="mt-esc-kind" className="mt-select" style={{ width: '100%' }} value={d.kind} onChange={(ev) => setD({ ...d, kind: ev.target.value as EscrowKind })}>
                {ESCROW_KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.option ?? k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-inline-form">
              <div className="mt-field">
                <label htmlFor="mt-esc-date">Date paid</label>
                <input id="mt-esc-date" type="date" className="mt-input" value={d.date} onChange={(ev) => setD({ ...d, date: ev.target.value })} />
              </div>
              <div className="mt-field">
                <label htmlFor="mt-esc-amount">Amount</label>
                <div className="mt-prefix">
                  <span>$</span>
                  <input id="mt-esc-amount" className="mt-input" inputMode="decimal" placeholder="0.00" value={d.amount} onChange={(ev) => setD({ ...d, amount: ev.target.value })} />
                </div>
              </div>
            </div>
            <div className="mt-field">
              <label htmlFor="mt-esc-note">Note</label>
              <input id="mt-esc-note" className="mt-input" placeholder="e.g. First half 2027, County Treasurer" value={d.note} onChange={(ev) => setD({ ...d, note: ev.target.value })} />
            </div>
            <div className="mt-row">
              <span className="mt-kpi-note" style={{ marginTop: 0 }}>
                From your servicer's statement or annual escrow analysis.
              </span>
              <span className="mt-spacer" />
              <button type="submit" className="mt-btn primary" disabled={busy}>
                Add
              </button>
            </div>
          </form>
          {error && (
            <div className="mt-note bad" style={{ marginTop: 10 }} role="alert">
              {error}
            </div>
          )}
        </div>
      </div>

      {esc.years.length > 0 && (
        <>
          <div className="mt-gap" />
          <div className="mt-card">
            <h3>By year</h3>
            <div className="mt-scroll">
              <table className="mt-data">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Collected</th>
                    <th>Deposited</th>
                    {YEAR_COLUMNS.map((c) => (
                      <th key={c.label}>{c.label}</th>
                    ))}
                    <th>Year-end balance</th>
                  </tr>
                </thead>
                <tbody>
                  {esc.years.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}</td>
                      <td>
                        <Amt cents={y.collected} />
                      </td>
                      <td className={y.deposited ? '' : 'muted'}>{y.deposited ? <Amt cents={y.deposited} /> : '—'}</td>
                      {YEAR_COLUMNS.map((c) => {
                        const v = yearSum(y, c.kinds);
                        return (
                          <td key={c.label} className={v ? '' : 'muted'}>
                            {v ? <Amt cents={v} /> : '—'}
                          </td>
                        );
                      })}
                      <td style={{ fontWeight: 600 }}>
                        <Amt cents={y.endBalance} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="mt-gap" />
      <div className="mt-card">
        <h3>Ledger</h3>
        {lines.length === 0 ? (
          <div className="mt-empty">
            Escrow from each reconciled payment shows up here automatically.
            <br />
            Add the initial deposit from your closing disclosure, then each tax and insurance bill the servicer pays.
          </div>
        ) : (
          <div className="mt-scroll">
            <table className="mt-data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="l">Description</th>
                  <th>Amount</th>
                  <th>Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.kind}-${l.payment ?? l.entryId}-${i}`}>
                    <td>{date(l.date)}</td>
                    <td className="l">
                      {l.label}
                      {l.note && <span className="muted"> · {l.note}</span>}
                    </td>
                    <td className={l.amount < 0 ? 'neg' : ''}>
                      <Amt cents={l.amount} sign />
                    </td>
                    <td>
                      <Amt cents={l.balance} />
                    </td>
                    <td style={{ width: 1 }}>
                      {l.entryId !== null && (
                        <button type="button" className="mt-x" aria-label={`Remove ${l.label} on ${date(l.date)}`} disabled={busy} onClick={() => run(() => client.deleteEscrowEntry(l.entryId!))}>
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
