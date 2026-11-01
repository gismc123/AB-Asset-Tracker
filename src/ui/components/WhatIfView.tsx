import { useEffect, useMemo, useRef, useState } from 'react';
import { addYears, type Cents, type ISODate, type WhatIfResult } from '../../engine/index.js';
import type { LoanClient, StateView } from '../api.js';
import { date, duration, money, parseDollars } from '../format.js';
import { Amt } from './Amt.js';

interface Props {
  state: StateView;
  client: LoanClient;
  onState(state: StateView): void;
}

/**
 * "What if I paid more?" Try a monthly extra, a one-time lump sum, or both,
 * and see the payoff date and interest next to the loan as it stands. Only
 * the "make it my standing extra" button saves anything.
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

  const monthlyCents = Math.max(0, parseDollars(monthly) ?? 0);
  const lumpCents = Math.max(0, parseDollars(lump.amount) ?? 0);
  const hasAsset = !!state.analysis?.equity;

  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      client
        .whatIf({
          monthlyExtra: monthlyCents,
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
      setSaved(`${money(monthlyCents)} more a month is now part of your schedule, from payment #${result?.input.fromPayment}.`);
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

  const r = result;
  const trying = monthlyCents > 0 || lumpCents > 0;
  const now = r?.current.payment ?? null;
  const next = r?.next ?? null;
  const picks = quickPicks(now);
  const tried =
    monthlyCents > 0 && lumpCents > 0
      ? `${money(monthlyCents)} more a month and ${money(lumpCents, { whole: true })} once`
      : monthlyCents > 0
        ? `${money(monthlyCents)} more a month`
        : `${money(lumpCents, { whole: true })} once`;

  return (
    <div>
      <div className="mt-card">
        <h3>What if you paid more?</h3>
        <p style={{ marginTop: 0 }}>
          Try an amount to see when the loan would be paid off and how much interest you'd save. Nothing changes unless you choose to keep it.
        </p>
        {next && now !== null && (
          <p>
            Your payment now: <b><Amt cents={now} /></b> a month
            {next.extraPrincipal > 0 && (
              <>
                , including the <Amt cents={next.extraPrincipal} /> extra you already pay
              </>
            )}
            .
          </p>
        )}

        <div className="mt-step" style={{ marginTop: 16 }}>
          Pay more every month
        </div>
        <div className="mt-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="mt-prefix" style={{ width: 150 }}>
            <span>$</span>
            <input
              id="mt-wi-monthly"
              aria-label="Extra each month"
              className="mt-input"
              inputMode="decimal"
              placeholder="0"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </div>
          {picks.map((p) => (
            <button
              key={p.label}
              type="button"
              className="mt-btn small"
              aria-pressed={monthlyCents === p.cents}
              onClick={() => setMonthly(monthlyCents === p.cents ? '' : dollars(p.cents))}
            >
              {p.label}
            </button>
          ))}
        </div>
        {monthlyCents > 0 && now !== null && next && (
          <p className="mt-kpi-note">
            You'd pay <b><Amt cents={now + monthlyCents} /></b> a month, starting with payment #{next.payment} on {date(next.dueDate)}. The extra goes
            to principal.
          </p>
        )}

        <div className="mt-step" style={{ marginTop: 18 }}>
          Or pay a lump sum once <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
        </div>
        <div className="mt-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="mt-prefix" style={{ width: 150 }}>
            <span>$</span>
            <input
              id="mt-wi-lump"
              aria-label="One-time payment"
              className="mt-input"
              inputMode="decimal"
              placeholder="0"
              value={lump.amount}
              onChange={(e) => setLump({ ...lump, amount: e.target.value })}
            />
          </div>
          <label htmlFor="mt-wi-lump-date" style={{ fontWeight: 400 }}>
            on
          </label>
          <input
            id="mt-wi-lump-date"
            type="date"
            className="mt-input"
            style={{ width: 'auto' }}
            value={lump.date}
            onChange={(e) => setLump({ ...lump, date: e.target.value })}
          />
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
          <div className="mt-card">
            <h3>{trying ? `With ${tried}` : 'As it stands'}</h3>
            <p className="mt-headline" style={trying ? undefined : { marginBottom: 0 }}>
              <Headline r={r} trying={trying} />
            </p>
            {trying && (
              <table className="mt-data">
                <thead>
                  <tr>
                    <th className="l" />
                    <th>As it stands</th>
                    <th>With the extra</th>
                  </tr>
                </thead>
                <tbody>
                  <Compare label="Monthly payment" current={r.current.payment} scenario={r.scenario.payment} money />
                  <tr>
                    <td className="l">Paid off</td>
                    <td>{date(r.current.payoffDate, 'month')}</td>
                    <td className={r.monthsSaved > 0 ? 'good' : undefined}>{date(r.scenario.payoffDate, 'month')}</td>
                  </tr>
                  <Compare label="Payments left" current={r.current.paymentsLeft} scenario={r.scenario.paymentsLeft} lowerIsBetter />
                  <Compare label="Interest still to pay" current={r.current.interestLeft} scenario={r.scenario.interestLeft} money whole lowerIsBetter />
                </tbody>
              </table>
            )}

            {monthlyCents > 0 && (
              <div style={{ marginTop: 16 }}>
                <button type="button" className="mt-btn primary" disabled={busy} onClick={makeStanding}>
                  Keep it: add {money(monthlyCents)} a month to my schedule
                </button>
                <p className="mt-kpi-note">
                  The schedule then expects <Amt cents={(now ?? 0) + monthlyCents} /> from payment #{r.input.fromPayment} on. Payments already
                  reconciled stay as they were, and you can remove it below.
                </p>
              </div>
            )}
            {lumpCents > 0 && (
              <p className="mt-kpi-note">The lump sum isn't saved here. When you pay it, add it under Reconcile as an extra payment.</p>
            )}
            {saved && (
              <div className="mt-note good" style={{ marginTop: 10 }}>
                {saved}
              </div>
            )}
          </div>

          <div className="mt-gap" />
          <div className="mt-card">
            <h3>Balance</h3>
            <CompareChart balances={r.balances} trying={trying} />
            <div className="mt-row" style={{ marginTop: 6, color: 'var(--muted)', fontSize: 12 }}>
              <span>
                <span className="mt-swatch" style={{ background: trying ? 'var(--muted)' : 'var(--primary)', display: 'inline-block', marginRight: 4, verticalAlign: -1 }} /> As it
                stands
              </span>
              {trying && (
                <span>
                  <span className="mt-swatch" style={{ background: 'var(--primary)', display: 'inline-block', marginRight: 4, verticalAlign: -1 }} /> With the extra
                </span>
              )}
            </div>
          </div>

          <div className="mt-gap" />
          <div className="mt-card">
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>What you'd owe on particular dates{hasAsset ? ', and your equity' : ''}</summary>
              <div className="mt-row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {dates.map((d, i) => (
                  <input
                    key={i}
                    aria-label={`Date ${i + 1}`}
                    type="date"
                    className="mt-input"
                    style={{ width: 'auto' }}
                    value={d}
                    onChange={(e) => setDates(dates.map((x, k) => (k === i ? e.target.value : x)))}
                  />
                ))}
              </div>
              <PointsTable r={r} trying={trying} hasAsset={hasAsset} />
            </details>
          </div>
        </>
      )}

      {standing.length > 0 && (
        <>
          <div className="mt-gap" />
          <div className="mt-card">
            <h3>Extra you've added from here</h3>
            <table className="mt-data">
              <tbody>
                {standing.map((a) => {
                  const adj = a.adjustment as Extract<typeof a.adjustment, { kind: 'standingExtra' }>;
                  return (
                    <tr key={a.id}>
                      <td className="l">From payment #{adj.fromPayment}</td>
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
          </div>
        </>
      )}
    </div>
  );
}

/** Cents as dollars for the input box: "50", or "43.38". */
const dollars = (cents: Cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

/** One-click amounts sized to the payment, led by rounding it up to an even amount. */
function quickPicks(payment: Cents | null): { label: string; cents: Cents }[] {
  if (!payment) return [];
  const big = payment >= 150_000;
  const steps = big ? [10_000, 25_000, 50_000] : [2_500, 5_000, 10_000];
  const picks = steps.map((cents) => ({ label: `+${money(cents, { whole: true })}`, cents }));
  const unit = big ? 10_000 : 5_000;
  const rounded = Math.floor(payment / unit) * unit + unit;
  if (!steps.includes(rounded - payment)) picks.unshift({ label: `Round up to ${money(rounded, { whole: true })}`, cents: rounded - payment });
  return picks;
}

function Headline({ r, trying }: { r: WhatIfResult; trying: boolean }) {
  if (!trying) {
    return (
      <>
        Paid off in {date(r.current.payoffDate, 'month')}, after {r.current.paymentsLeft} more payment{r.current.paymentsLeft === 1 ? '' : 's'}, with{' '}
        <Amt cents={r.current.interestLeft} whole /> of interest still to pay.
      </>
    );
  }
  if (r.monthsSaved <= 0 && r.interestSaved <= 0) return <>That doesn't change the payoff.</>;
  return (
    <>
      Paid off in {date(r.scenario.payoffDate, 'month')}
      {r.monthsSaved > 0 ? (
        <>
          , <span className="good">{duration(r.monthsSaved)} sooner</span>,
        </>
      ) : (
        ', the same month,'
      )}{' '}
      and you'd pay{' '}
      <span className="good">
        <Amt cents={r.interestSaved} whole /> less interest
      </span>
      .
    </>
  );
}

function Compare(props: { label: string; current: number | null; scenario: number | null; money?: boolean; whole?: boolean; lowerIsBetter?: boolean }) {
  const show = (v: number | null) => (v === null ? '' : props.money ? <Amt cents={v} whole={props.whole} /> : v);
  const better = props.lowerIsBetter && props.scenario !== null && props.current !== null && props.scenario < props.current;
  return (
    <tr>
      <td className="l">{props.label}</td>
      <td>{show(props.current)}</td>
      <td className={better ? 'good' : undefined}>{show(props.scenario)}</td>
    </tr>
  );
}

function PointsTable({ r, trying, hasAsset }: { r: WhatIfResult; trying: boolean; hasAsset: boolean }) {
  if (!r.at.length) return null;
  return (
    <table className="mt-data" style={{ marginTop: 12 }}>
      <thead>
        <tr>
          <th className="l">On</th>
          <th>You'd owe</th>
          {trying && <th>With the extra</th>}
          {hasAsset && <th>Equity</th>}
          {hasAsset && trying && <th>With the extra</th>}
        </tr>
      </thead>
      <tbody>
        {r.at.map((p) => {
          const better = p.scenario.owed < p.current.owed;
          const equity = (v: Cents | null, good: boolean) => (
            <td className={v !== null && v < 0 ? 'neg' : good ? 'good' : undefined}>{v === null ? '' : <Amt cents={v} whole />}</td>
          );
          return (
            <tr key={p.date}>
              <td className="l">{date(p.date)}</td>
              <td>
                <Amt cents={p.current.owed} whole />
              </td>
              {trying && (
                <td className={better ? 'good' : undefined}>
                  <Amt cents={p.scenario.owed} whole />
                </td>
              )}
              {hasAsset && equity(p.current.equity, false)}
              {hasAsset && trying && equity(p.scenario.equity, better)}
            </tr>
          );
        })}
      </tbody>
      {hasAsset && (
        <tfoot>
          <tr>
            <td colSpan={5} className="l mt-kpi-note" style={{ border: 0, paddingTop: 6 }}>
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

/** The balance as it stands, and with what was tried. */
function CompareChart({ balances, trying }: { balances: WhatIfResult['balances']; trying: boolean }) {
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
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={trying ? 'Balance as it stands and with the extra' : 'Balance as it stands'}>
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
      <path d={geo.current} fill="none" stroke={trying ? 'var(--muted)' : 'var(--primary)'} strokeWidth="2" />
      {trying && <path d={geo.scenario} fill="none" stroke="var(--primary)" strokeWidth="2.5" />}
    </svg>
  );
}
