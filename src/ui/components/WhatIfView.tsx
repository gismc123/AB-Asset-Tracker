import { useEffect, useMemo, useRef, useState } from 'react';
import { addYears, type ISODate, type WhatIfResult } from '../../engine/index.js';
import type { LoanClient, StateView } from '../api.js';
import { date, duration, money, parseDollars } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  state: StateView;
  client: LoanClient;
  onState(state: StateView): void;
}

/**
 * Try paying more without changing anything: a monthly extra, a one-time
 * lump sum, or both, side by side with the plan as it stands. Only the
 * "make this my standing extra" button saves anything.
 */
export function WhatIfView({ state, client, onState }: Props) {
  const today = state.today;
  const [monthly, setMonthly] = useState('');
  const [lump, setLump] = useState({ amount: '', date: today });
  const [dates, setDates] = useState<ISODate[]>(() => [1, 5, 10].map((y) => addYears(today, y)));
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const seq = useRef(0);

  const monthlyCents = parseDollars(monthly) ?? 0;
  const lumpCents = parseDollars(lump.amount) ?? 0;
  const hasAsset = !!state.analysis?.equity;

  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      client
        .whatIf({
          monthlyExtra: Math.max(0, monthlyCents),
          lumpSum: lumpCents > 0 && lump.date ? { date: lump.date, amount: lumpCents } : null,
          dates: dates.filter(Boolean),
        })
        .then(
          (r) => {
            if (n !== seq.current) return;
            setResult(r);
            setError(null);
          },
          (e: Error) => n === seq.current && setError(e.message),
        );
    }, 250);
    return () => clearTimeout(t);
    // The state changes when a standing extra is saved; the plan has to follow it.
  }, [client, monthlyCents, lumpCents, lump.date, dates, state]);

  const standing = state.adjustments.filter((a) => a.adjustment.kind === 'standingExtra' && a.sourcePayment === null);
  const makeStanding = async () => {
    setBusy(true);
    setError(null);
    try {
      onState(await client.setStandingExtra(monthlyCents));
      setSaved(`${money(monthlyCents)} a month is now part of the schedule from payment #${result?.input.fromPayment}.`);
      setMonthly('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const removeStanding = async (id: number) => {
    setBusy(true);
    try {
      onState(await client.deleteStandingExtra(id));
      setSaved(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const trying = monthlyCents > 0 || lumpCents > 0;
  const r = result;

  return (
    <div>
      <div className="mt-card">
        <h3>Try paying more</h3>
        <p className="mt-kpi-note" style={{ marginTop: 0 }}>
          Nothing here changes your schedule. It starts from the loan as it stands today, with every payment, extra and skip you've
          recorded, and adds what you try from payment #{r?.input.fromPayment ?? '…'} on.
        </p>
        <div className="mt-inline-form">
          <div className="mt-field">
            <label htmlFor="mt-wi-monthly">Extra each month</label>
            <div className="mt-prefix">
              <span>$</span>
              <input id="mt-wi-monthly" className="mt-input" inputMode="decimal" placeholder="200" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </div>
          </div>
          <div className="mt-field">
            <label htmlFor="mt-wi-lump">One-time payment</label>
            <div className="mt-prefix">
              <span>$</span>
              <input id="mt-wi-lump" className="mt-input" inputMode="decimal" placeholder="5,000" value={lump.amount} onChange={(e) => setLump({ ...lump, amount: e.target.value })} />
            </div>
          </div>
          <div className="mt-field">
            <label htmlFor="mt-wi-lump-date">Paid on</label>
            <input id="mt-wi-lump-date" type="date" className="mt-input" value={lump.date} onChange={(e) => setLump({ ...lump, date: e.target.value })} />
          </div>
        </div>
        <div className="mt-inline-form" style={{ marginTop: 10 }}>
          {dates.map((d, i) => (
            <div className="mt-field" key={i}>
              <label htmlFor={`mt-wi-date-${i}`}>Compare on</label>
              <input
                id={`mt-wi-date-${i}`}
                type="date"
                className="mt-input"
                value={d}
                onChange={(e) => setDates(dates.map((x, k) => (k === i ? e.target.value : x)))}
              />
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-note bad" style={{ marginTop: 14 }} role="alert">
          {error}
        </div>
      )}

      {r && (
        <>
          <div className="mt-gap" />
          <div className="mt-grid mt-halves">
            <div className="mt-card">
              <div className="mt-kpi-label">As it stands</div>
              <div className="mt-kpi-value">{date(r.current.payoffDate, 'month')}</div>
              <div className="mt-kpi-note">Paid off · {r.current.payments} payments</div>
              <PointsTable r={r} side="current" hasAsset={hasAsset} />
              <div className="mt-kpi-note" style={{ marginTop: 10 }}>
                Interest over the loan: <Amt cents={r.current.interest} whole />
              </div>
            </div>
            <div className="mt-card">
              <div className="mt-kpi-label">{trying ? 'With what you tried' : 'Enter an amount above'}</div>
              <div className={`mt-kpi-value ${r.monthsSaved > 0 ? 'good' : ''}`}>{date(r.scenario.payoffDate, 'month')}</div>
              <div className="mt-kpi-note">
                {r.monthsSaved > 0 ? <b>{duration(r.monthsSaved)} sooner</b> : 'Same payoff date'} · {r.scenario.payments} payments
              </div>
              <PointsTable r={r} side="scenario" hasAsset={hasAsset} />
              <div className="mt-kpi-note" style={{ marginTop: 10 }}>
                Interest over the loan: <Amt cents={r.scenario.interest} whole />
                {r.interestSaved > 0 && <> (<Amt cents={r.interestSaved} whole /> less)</>}
              </div>
            </div>
          </div>

          <div className="mt-gap" />
          <div className="mt-card">
            <h3>Balance</h3>
            <CompareChart balances={r.balances} />
            <div className="mt-row" style={{ marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>
              <span><span className="mt-swatch" style={{ background: 'var(--muted)', display: 'inline-block', marginRight: 4, verticalAlign: -1 }} /> As it stands</span>
              <span><span className="mt-swatch" style={{ background: 'var(--primary)', display: 'inline-block', marginRight: 4, verticalAlign: -1 }} /> With what you tried</span>
            </div>
          </div>
        </>
      )}

      <div className="mt-gap" />
      <div className="mt-card">
        <h3>Make it real</h3>
        {monthlyCents > 0 && r ? (
          <>
            <p style={{ marginTop: 0 }}>
              From payment #{r.input.fromPayment} on, the schedule will expect <Amt cents={monthlyCents} /> more with each payment, as
              extra principal. Reconciled months keep what they paid.
            </p>
            <button type="button" className="mt-btn primary" disabled={busy} onClick={makeStanding}>
              Make {money(monthlyCents)} a month my standing extra
            </button>
          </>
        ) : (
          <p style={{ marginTop: 0 }}>Enter an extra each month above to make it part of your schedule.</p>
        )}
        {lumpCents > 0 && (
          <p className="mt-kpi-note">The one-time payment isn't saved. When you make it, add it under Reconcile as an extra payment.</p>
        )}
        {saved && (
          <div className="mt-note good" style={{ marginTop: 10 }}>
            {saved}
          </div>
        )}
        {standing.length > 0 && (
          <table className="mt-data" style={{ marginTop: 12 }}>
            <tbody>
              {standing.map((a) => {
                const adj = a.adjustment as Extract<typeof a.adjustment, { kind: 'standingExtra' }>;
                return (
                  <tr key={a.id}>
                    <td className="l">Standing extra from payment #{adj.fromPayment}</td>
                    <td>
                      <Amt cents={adj.amount} /> a month
                    </td>
                    <td style={{ width: 1 }}>
                      <button type="button" className="mt-btn link" disabled={busy} onClick={() => removeStanding(a.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PointsTable({ r, side, hasAsset }: { r: WhatIfResult; side: 'current' | 'scenario'; hasAsset: boolean }) {
  if (!r.at.length) return null;
  return (
    <table className="mt-data" style={{ marginTop: 12 }}>
      <thead>
        <tr>
          <th className="l">On</th>
          <th>You'd owe</th>
          {hasAsset && <th>Equity</th>}
        </tr>
      </thead>
      <tbody>
        {r.at.map((p) => {
          const v = p[side];
          const better = side === 'scenario' && v.owed < p.current.owed;
          return (
            <tr key={p.date}>
              <td className="l">{date(p.date)}</td>
              <td className={better ? 'good' : undefined}>
                <Amt cents={v.owed} whole />
              </td>
              {hasAsset && <td className={v.equity !== null && v.equity < 0 ? 'neg' : better ? 'good' : undefined}>{v.equity === null ? '' : <Amt cents={v.equity} whole />}</td>}
            </tr>
          );
        })}
      </tbody>
      {hasAsset && (
        <tfoot>
          <tr>
            <td colSpan={3} className="l mt-kpi-note" style={{ border: 0, paddingTop: 6 }}>
              Equity uses the value you entered{r.at.some((p) => p.value !== null) ? ', or its projected curve (an estimate),' : ''} on each date.
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

const W = 1000;
const H = 240;
const PAD = { top: 10, right: 12, bottom: 22, left: 56 };

/** Two balance lines: the plan as it stands, and with what was tried. */
function CompareChart({ balances }: { balances: WhatIfResult['balances'] }) {
  const geo = useMemo(() => {
    const max = Math.max(1, ...balances.map((b) => Math.max(b.current ?? 0, b.scenario ?? 0)));
    const n = Math.max(1, balances.length - 1);
    const x = (i: number) => PAD.left + (i / n) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
    const line = (key: 'current' | 'scenario') =>
      balances
        .map((b, i) => (b[key] === null ? null : `${x(i).toFixed(1)},${y(b[key]!).toFixed(1)}`))
        .filter(Boolean)
        .map((p, i) => `${i ? 'L' : 'M'}${p}`)
        .join('');
    const years = balances
      .map((b, i) => ({ i, y: b.dueDate.slice(0, 4) }))
      .filter((p, k, all) => k === 0 || p.y !== all[k - 1]!.y)
      .filter((_, k, all) => all.length <= 8 || k % Math.ceil(all.length / 8) === 0);
    return { current: line('current'), scenario: line('scenario'), x, y, max, years };
  }, [balances]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Balance as it stands and with what you tried">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.left} x2={W - PAD.right} y1={geo.y(geo.max * f)} y2={geo.y(geo.max * f)} stroke="var(--border)" />
          <text x={PAD.left - 6} y={geo.y(geo.max * f) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
            {money(geo.max * f, { whole: true })}
          </text>
        </g>
      ))}
      {geo.years.map((t) => (
        <text key={t.i} x={geo.x(t.i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
          {t.y}
        </text>
      ))}
      <path d={geo.current} fill="none" stroke="var(--muted)" strokeWidth="2" />
      <path d={geo.scenario} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
    </svg>
  );
}
