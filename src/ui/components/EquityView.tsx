import { useMemo, useState } from 'react';
import type { PeriodBasis, PeriodBreakouts, PeriodTotals } from '../../engine/index.js';
import type { MortgageClient, StateView } from '../api.js';
import { date, parseDollars, percent } from '../format.js';
import { Amt } from './Amt.js';
import { TrendChart } from './TrendChart.js';

interface Props {
  state: StateView;
  client: MortgageClient;
  onState(state: StateView): void;
}

const SOURCES = ['Appraisal', 'Tax assessment', 'Online estimate', 'Broker price opinion'];

/** Equity today, how it was built, where it's heading, and where the payments went. */
export function EquityView({ state, client, onState }: Props) {
  const a = state.analysis!;
  const e = a.equity;
  const pmiActive = state.summary?.pmi.active ?? false;

  return (
    <div>
      <div className="mt-grid mt-kpis">
        <div className="mt-card">
          <div className="mt-kpi-label">Home value</div>
          <div className="mt-kpi-value">
            <Amt cents={e.homeValue} whole />
          </div>
          <div className="mt-kpi-note">
            {e.isEstimate ? `${e.homeValueSource} · ${date(e.homeValueAsOf)}` : 'Original value. Add an estimate below.'}
          </div>
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">You owe</div>
          <div className="mt-kpi-value">
            <Amt cents={e.owed} />
          </div>
          <div className="mt-kpi-note">
            {e.deferredBalance > 0 ? (
              <>
                Includes <Amt cents={e.deferredBalance} /> deferred
              </>
            ) : (
              'Loan balance'
            )}
          </div>
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">Equity</div>
          <div className="mt-kpi-value">
            <Amt cents={e.equity} whole />
          </div>
          <div className="mt-kpi-note">{percent(e.equityPercent)} of the home's value</div>
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">Loan-to-value</div>
          <div className="mt-kpi-value">{percent(e.ltv)}</div>
          <div className="mt-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={e.ltv} aria-label="Loan-to-value">
            <span style={{ width: `${Math.min(100, Math.max(0, e.ltv))}%` }} />
          </div>
        </div>
      </div>

      {pmiActive && e.isEstimate && e.ltv <= 80 && (
        <div className="mt-note good" style={{ marginTop: 14 }}>
          At your latest estimate you owe {percent(e.ltv)} of the home's value. Many conventional loans allow PMI removal based on a
          new appraisal once the loan-to-value is about 75% (loans 2–5 years old) or 80% (over 5 years). Ask your servicer what they
          require.
        </div>
      )}

      <div className="mt-gap" />
      <div className="mt-grid mt-two">
        <EquityParts state={state} />
        <HomeValues state={state} client={client} onState={onState} />
      </div>

      <div className="mt-gap" />
      <div className="mt-grid mt-two">
        <div className="mt-card">
          <h3>Equity over time</h3>
          <TrendChart
            label="Equity after each payment"
            actualUntil={e.settledIndex}
            points={e.projection.map((p) => ({ date: p.dueDate, value: p.equity, note: `Payment #${p.payment}` }))}
          />
          <div className="mt-kpi-note" style={{ marginTop: 8 }}>
            Solid: payments made. Dashed: the schedule ahead, at today's home value.
          </div>
        </div>
        <div className="mt-card">
          <h3>Equity milestones</h3>
          <div className="mt-milestones" style={{ marginTop: 0 }}>
            {e.milestones.map((m) => (
              <div className="mt-milestone" key={m.percent}>
                <span className={`mt-dot ${m.reached ? 'done' : ''}`} aria-hidden="true" />
                <div>
                  <div className="t">{m.percent === 100 ? 'Paid off' : `${m.percent}% equity`}</div>
                  <div className="d">{milestoneText(m.percent)}</div>
                </div>
                <div className="r">
                  {m.reached ? 'Reached' : date(m.dueDate)}
                  <div className="d">{m.payment ? `payment #${m.payment}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-gap" />
      <Breakouts periods={a.periods} hasPaid={state.schedule!.rows.some((r) => r.status === 'paid')} />
    </div>
  );
}

function milestoneText(p: number): string {
  if (p === 20) return 'Typical point where PMI can be dropped';
  if (p === 22) return 'Matches the 78% automatic PMI line';
  if (p === 25) return 'Common cutoff for appraisal-based PMI removal';
  if (p === 50) return 'You own more of the home than the lender';
  if (p === 75) return 'Three quarters owned';
  return 'The home is yours outright';
}

function EquityParts({ state }: { state: StateView }) {
  const e = state.analysis!.equity;
  const parts = [
    { label: 'Down payment', note: 'Original value minus the amount borrowed', value: e.parts.startingEquity },
    { label: 'Principal paid', note: 'From regular payments', value: e.parts.principalPaid },
    { label: 'Extra principal', note: 'Paid on top of the schedule', value: e.parts.extraPrincipal },
    { label: 'Home value change', note: e.isEstimate ? `Since purchase, per ${e.homeValueSource.toLowerCase()}` : 'Add an estimate to include it', value: e.parts.marketChange },
    { label: 'Skipped payments', note: 'Interest added or payments deferred', value: e.parts.skipped },
  ].filter((p, i) => i < 2 || p.value !== 0 || (i === 3 && !e.isEstimate));
  const max = Math.max(1, ...parts.map((p) => Math.abs(p.value)));

  return (
    <div className="mt-card">
      <h3>How your equity was built</h3>
      <div className="mt-parts">
        {parts.map((p) => (
          <div className="mt-part" key={p.label}>
            <div>
              <div style={{ fontWeight: 600 }}>{p.label}</div>
              <div className="mt-kpi-note" style={{ marginTop: 0 }}>{p.note}</div>
            </div>
            <div aria-hidden="true">
              <div className={`bar ${p.value < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(p.value) / max) * 100}%` }} />
            </div>
            <div className="v">
              <Amt cents={p.value} sign={p.value < 0} />
            </div>
          </div>
        ))}
        <div className="mt-part total">
          <div>Equity</div>
          <div />
          <div className="v">
            <Amt cents={e.equity} />
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeValues({ state, client, onState }: Props) {
  const [d, setD] = useState({ date: state.today, value: '', source: 'Online estimate' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const values = [...state.homeValues].reverse();

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
    const cents = parseDollars(d.value);
    if (!cents || cents <= 0) return setError('Enter the value, like 410,000');
    if (await run(() => client.addHomeValue({ date: d.date, value: cents, source: d.source.trim() || 'Estimate' }))) {
      setD((p) => ({ ...p, value: '' }));
    }
  };

  return (
    <div className="mt-card">
      <h3>Home value</h3>
      {values.length === 0 ? (
        <p className="mt-kpi-note" style={{ marginTop: 0 }}>
          Equity uses your original home value until you add an estimate. The newest estimate is used.
        </p>
      ) : (
        <table className="mt-data" style={{ marginBottom: 12 }}>
          <tbody>
            {values.map((v, i) => (
              <tr key={v.id}>
                <td className="l">
                  {date(v.date)}
                  {i === 0 && <span className="mt-pill paid" style={{ marginLeft: 6 }}>In use</span>}
                </td>
                <td className="l muted">{v.source}</td>
                <td>
                  <Amt cents={v.value} whole />
                </td>
                <td style={{ width: 1 }}>
                  <button type="button" className="mt-x" aria-label={`Remove the ${date(v.date)} estimate`} disabled={busy} onClick={() => run(() => client.deleteHomeValue(v.id))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="mt-inline-form" onSubmit={add}>
        <div className="mt-field">
          <label htmlFor="mt-hv-date">As of</label>
          <input id="mt-hv-date" type="date" className="mt-input" value={d.date} onChange={(ev) => setD({ ...d, date: ev.target.value })} />
        </div>
        <div className="mt-field">
          <label htmlFor="mt-hv-value">Value</label>
          <div className="mt-prefix">
            <span>$</span>
            <input id="mt-hv-value" className="mt-input" inputMode="decimal" placeholder="410,000" value={d.value} onChange={(ev) => setD({ ...d, value: ev.target.value })} />
          </div>
        </div>
        <div className="mt-field">
          <label htmlFor="mt-hv-source">Source</label>
          <input id="mt-hv-source" className="mt-input" list="mt-hv-sources" value={d.source} onChange={(ev) => setD({ ...d, source: ev.target.value })} />
          <datalist id="mt-hv-sources">
            {SOURCES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <button type="submit" className="mt-btn" disabled={busy}>
          Add estimate
        </button>
      </form>
      {error && (
        <div className="mt-note bad" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      )}
      <div className="mt-kpi-note" style={{ marginTop: 10 }}>
        PMI dates on the Overview always use the original value, as lenders do.
      </div>
    </div>
  );
}

const ROWS: { key: keyof PeriodTotals; label: string; color?: string }[] = [
  { key: 'principal', label: 'Principal', color: 'var(--s-principal)' },
  { key: 'extraPrincipal', label: 'Extra principal' },
  { key: 'interest', label: 'Interest', color: 'var(--s-interest)' },
  { key: 'pmi', label: 'PMI', color: 'var(--s-pmi)' },
  { key: 'escrow', label: 'Escrow', color: 'var(--s-escrow)' },
  { key: 'deferredRepaid', label: 'Deferred balance repaid' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Breakouts({ periods, hasPaid }: { periods: Record<PeriodBasis, PeriodBreakouts>; hasPaid: boolean }) {
  const [basis, setBasis] = useState<PeriodBasis>(hasPaid ? 'paid' : 'scheduled');
  const p = periods[basis];
  const cols = useMemo(() => {
    const [y, m] = p.month.start.split('-').map(Number) as [number, number];
    return [
      { id: 'month', label: `${MONTHS[m - 1]} ${y}`, sub: 'This month', t: p.month.totals },
      { id: 'quarter', label: `Q${Math.floor((m - 1) / 3) + 1} ${y}`, sub: 'This quarter', t: p.quarter.totals },
      { id: 'ytd', label: `${y}`, sub: 'Year to date', t: p.yearToDate.totals },
      { id: 'ltd', label: 'Loan to date', sub: `Since ${date(p.loanToDate.start, 'month')}`, t: p.loanToDate.totals },
      { id: 'full', label: 'Life of loan', sub: 'Paid and scheduled', t: p.fullLoan.totals },
    ];
  }, [p]);
  const rows = ROWS.filter((r) => r.key !== 'extraPrincipal' && r.key !== 'deferredRepaid' ? true : cols.some((c) => c.t[r.key] !== 0));
  const skipped = cols.some((c) => c.t.skipped > 0);

  return (
    <div className="mt-card">
      <div className="mt-row" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Where your payments went</h3>
        <span className="mt-spacer" />
        <div className="mt-tabs" role="tablist" aria-label="Count payments by">
          <button type="button" role="tab" className="mt-tab" aria-selected={basis === 'paid'} onClick={() => setBasis('paid')}>
            Paid
          </button>
          <button type="button" role="tab" className="mt-tab" aria-selected={basis === 'scheduled'} onClick={() => setBasis('scheduled')}>
            Scheduled
          </button>
        </div>
      </div>
      <div className="mt-scroll">
        <table className="mt-data">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.id}>
                  {c.label}
                  <div style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{c.sub}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <span className="mt-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <span className="mt-swatch" style={{ background: r.color ?? 'transparent' }} />
                    {r.label}
                  </span>
                </td>
                {cols.map((c) => (
                  <td key={c.id} className={c.t[r.key] ? '' : 'muted'}>
                    {c.t[r.key] ? <Amt cents={c.t[r.key]} /> : '—'}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="total">
              <td>Total paid</td>
              {cols.map((c) => (
                <td key={c.id}>
                  <Amt cents={c.t.total} />
                </td>
              ))}
            </tr>
            <tr>
              <td className="muted">Payments</td>
              {cols.map((c) => (
                <td key={c.id} className="muted">
                  {c.t.payments}
                  {skipped && c.t.skipped > 0 ? ` + ${c.t.skipped} skipped` : ''}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-kpi-note" style={{ marginTop: 10 }}>
        {basis === 'paid'
          ? 'Reconciled payments, by the date your bank paid them. Your servicer’s year-end statement (Form 1098) counts interest the same way.'
          : 'Every payment due in each period, whether or not it has been reconciled yet.'}{' '}
        Life of loan always includes the payments still to come.
      </div>
    </div>
  );
}
