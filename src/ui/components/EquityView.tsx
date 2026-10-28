import { useEffect, useMemo, useState } from 'react';
import type { AssetKind, PeriodBasis, PeriodBreakouts, PeriodTotals, ValueTrend } from '../../engine/index.js';
import type { AssetRecord, LoanClient, StateView } from '../api.js';
import { centsToInput, date, parseDollars, percent } from '../format.js';
import { ASSET_KIND_LABEL, LOAN_TYPE_INFO, VALUE_SOURCES } from '../loanTypes.js';
import { Amt } from './Amt.js';
import { TrendChart } from './TrendChart.js';

interface Props {
  state: StateView;
  client: LoanClient;
  onState(state: StateView): void;
}

/**
 * Equity today, how it was built, where it's heading, and where the
 * payments went. A loan with no asset gets the payment totals and a way to
 * start tracking one.
 */
export function EquityView({ state, client, onState }: Props) {
  const a = state.analysis!;
  const e = a.equity;
  const asset = state.asset;
  const hasPaid = state.schedule!.rows.some((r) => r.status === 'paid' || r.status === 'history');

  if (!e) {
    return (
      <div>
        <Breakouts periods={a.periods} hasPaid={hasPaid} beforeTracking={!!state.setup?.startingPoint} />
        <div className="mt-gap" />
        <div className="mt-grid mt-two">
          <AssetEditor state={state} client={client} onState={onState} />
          <div />
        </div>
      </div>
    );
  }

  const kind: AssetKind = asset?.kind ?? 'home';
  const noun = ASSET_KIND_LABEL[kind].toLowerCase();
  const pmiActive = state.summary?.pmi.active ?? false;
  const projected = state.summary?.asset?.projectedValue ?? null;

  return (
    <div>
      <div className="mt-grid mt-kpis">
        <div className="mt-card">
          <div className="mt-kpi-label">{asset?.name ?? ASSET_KIND_LABEL[kind]} value</div>
          <div className="mt-kpi-value">
            <Amt cents={e.homeValue} whole />
          </div>
          <div className="mt-kpi-note">
            {e.isEstimate ? `${e.homeValueSource} · ${date(e.homeValueAsOf)}` : 'Original value. Add a newer value below.'}
          </div>
          {projected !== null && (
            <div className="mt-kpi-note">
              Projected today: <Amt cents={projected} whole /> (estimate)
            </div>
          )}
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">You owe</div>
          <div className="mt-kpi-value">
            <Amt cents={e.owed} />
          </div>
          <div className="mt-kpi-note">
            {e.pastDue > 0 || e.deferredBalance > 0 ? (
              <>
                Includes {e.pastDue > 0 && <><Amt cents={e.pastDue} /> past due</>}
                {e.pastDue > 0 && e.deferredBalance > 0 && ' and '}
                {e.deferredBalance > 0 && <><Amt cents={e.deferredBalance} /> deferred</>}
              </>
            ) : (
              'Loan balance'
            )}
          </div>
        </div>
        <div className="mt-card">
          <div className="mt-kpi-label">Equity</div>
          <div className={`mt-kpi-value ${e.equity < 0 ? 'neg' : ''}`}>
            <Amt cents={e.equity} whole />
          </div>
          <div className="mt-kpi-note">
            {e.equity < 0 ? `You owe more than the ${noun} is worth` : `${percent(e.equityPercent)} of the ${noun}'s value`}
          </div>
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
        <EquityParts state={state} kind={kind} />
        <AssetValues state={state} client={client} onState={onState} kind={kind} />
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
            Solid: payments made. Dashed: the schedule ahead.{' '}
            {e.projected
              ? `The ${noun}'s value follows its projected yearly ${asset?.valueTrend === 'depreciating' ? 'drop' : 'rise'} of ${asset?.trendRatePercent}%, starting from the values you entered (an estimate).`
              : `At today's ${noun} value.`}
          </div>
        </div>
        <div className="mt-card">
          <h3>Equity milestones</h3>
          <div className="mt-milestones" style={{ marginTop: 0 }}>
            {e.milestones.map((m) => (
              <div className="mt-milestone" key={m.percent}>
                <span className={`mt-dot ${m.reached ? 'done' : ''}`} aria-hidden="true" />
                <div>
                  <div className="t">{m.percent === 100 ? 'Paid off' : m.percent === 0 ? 'Worth more than you owe' : `${m.percent}% equity`}</div>
                  <div className="d">{milestoneText(m.percent, kind)}</div>
                </div>
                <div className="r">
                  {m.reached ? 'Reached' : m.dueDate ? date(m.dueDate) : 'Not on this schedule'}
                  <div className="d">{m.payment ? `payment #${m.payment}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-gap" />
      <Breakouts periods={a.periods} hasPaid={hasPaid} beforeTracking={!!state.setup?.startingPoint} />
      <div className="mt-gap" />
      <div className="mt-grid mt-two">
        <AssetEditor state={state} client={client} onState={onState} />
        <div />
      </div>
    </div>
  );
}

function milestoneText(p: number, kind: AssetKind): string {
  if (kind === 'home') {
    if (p === 20) return 'Typical point where PMI can be dropped';
    if (p === 22) return 'Matches the 78% automatic PMI line';
    if (p === 25) return 'Common cutoff for appraisal-based PMI removal';
    if (p === 50) return 'You own more of the home than the lender';
    if (p === 75) return 'Three quarters owned';
    return 'The home is yours outright';
  }
  const noun = ASSET_KIND_LABEL[kind].toLowerCase();
  if (p === 0) return `Selling the ${noun} would cover the loan`;
  if (p === 25) return 'A quarter of its value is yours';
  if (p === 50) return 'You own more of it than the lender';
  if (p === 75) return 'Three quarters owned';
  return `The ${noun} is yours outright`;
}

function EquityParts({ state, kind }: { state: StateView; kind: AssetKind }) {
  const e = state.analysis!.equity!;
  const dp = e.parts.downPayment;
  const splitStart = dp !== null && dp !== e.parts.startingEquity;
  const parts = [
    splitStart
      ? { label: 'Starting equity', note: 'Price minus the amount borrowed', value: e.parts.startingEquity }
      : { label: 'Down payment', note: 'Original value minus the amount borrowed', value: e.parts.startingEquity },
    { label: 'Principal paid', note: 'From regular payments', value: e.parts.principalPaid },
    { label: 'Extra principal', note: 'Paid on top of the schedule', value: e.parts.extraPrincipal },
    { label: 'Extra before tracking', note: 'Starting balance vs. the original schedule', value: e.parts.extraBeforeTracking },
    {
      label: 'Value change',
      note: e.isEstimate ? `Since purchase, per ${e.homeValueSource.toLowerCase()}` : 'Add a newer value to include it',
      value: e.parts.marketChange,
      always: !e.isEstimate,
    },
    { label: 'Skipped payments', note: 'Interest added, or payments deferred or not yet caught up', value: e.parts.skipped },
  ].filter((p, i) => i < 2 || p.value !== 0 || ('always' in p && p.always));
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
      {splitStart && (
        <div className="mt-kpi-note" style={{ marginTop: 10 }}>
          Your down payment was <Amt cents={dp} />. The rest of the starting equity is the gap between the price and what you
          borrowed (fees or a trade-in, for example).
        </div>
      )}
      {kind === 'vehicle' && (
        <div className="mt-kpi-note" style={{ marginTop: 10 }}>
          Vehicles usually lose value faster than the loan is paid down at first, so equity can start below zero.
        </div>
      )}
    </div>
  );
}

function AssetValues({ state, client, onState, kind }: Props & { kind: AssetKind }) {
  const [d, setD] = useState({ date: state.today, value: '', source: VALUE_SOURCES[kind][kind === 'home' ? 2 : 0]! });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asset = state.asset;
  const values = [...(asset?.values ?? [])].reverse();
  const noun = ASSET_KIND_LABEL[kind].toLowerCase();

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
    if (!asset) return setError(`Save the ${noun} below first`);
    const cents = parseDollars(d.value);
    if (!cents || cents <= 0) return setError('Enter the value, like 410,000');
    if (await run(() => client.addAssetValue(asset.id, { date: d.date, value: cents, source: d.source.trim() || 'Estimate' }))) {
      setD((p) => ({ ...p, value: '' }));
    }
  };

  return (
    <div className="mt-card">
      <h3>{ASSET_KIND_LABEL[kind]} value</h3>
      {values.length === 0 ? (
        <p className="mt-kpi-note" style={{ marginTop: 0 }}>
          Equity uses the original value until you add a newer one. The newest value is used.
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
                  <button type="button" className="mt-x" aria-label={`Remove the ${date(v.date)} value`} disabled={busy} onClick={() => run(() => client.deleteAssetValue(asset!.id, v.id))}>
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
            <input id="mt-hv-value" className="mt-input" inputMode="decimal" placeholder={kind === 'home' ? '410,000' : '24,000'} value={d.value} onChange={(ev) => setD({ ...d, value: ev.target.value })} />
          </div>
        </div>
        <div className="mt-field">
          <label htmlFor="mt-hv-source">Source</label>
          <input id="mt-hv-source" className="mt-input" list="mt-hv-sources" value={d.source} onChange={(ev) => setD({ ...d, source: ev.target.value })} />
          <datalist id="mt-hv-sources">
            {VALUE_SOURCES[kind].map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <button type="submit" className="mt-btn" disabled={busy}>
          Add value
        </button>
      </form>
      {error && (
        <div className="mt-note bad" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      )}
      {kind === 'home' && state.setup && state.summary?.pmi.hasPmi && (
        <div className="mt-kpi-note" style={{ marginTop: 10 }}>
          PMI dates on the Overview always use the original value, as lenders do.
        </div>
      )}
    </div>
  );
}

/** Create the loan's asset, or edit its name, original value and value trend. */
function AssetEditor({ state, client, onState }: Props) {
  const asset = state.asset;
  const defaultKind: AssetKind = LOAN_TYPE_INFO[state.loan.type].assetKind ?? 'other';
  const fromAsset = (a: AssetRecord | null) => ({
    name: a?.name ?? '',
    kind: a?.kind ?? defaultKind,
    value: centsToInput(a?.originalValue),
    trend: a?.valueTrend ?? ('manual' as ValueTrend),
    rate: a?.trendRatePercent === null || a?.trendRatePercent === undefined ? '' : String(a.trendRatePercent),
    acquired: a?.acquiredDate ?? state.setup?.openDate ?? '',
  });
  const [d, setD] = useState(() => fromAsset(asset));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Follow saves (and switching loans) without losing an edit in progress otherwise.
  useEffect(() => setD(fromAsset(asset)), [asset]);

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!d.name.trim()) out.push('Give it a name');
    const v = parseDollars(d.value);
    if (v === null || v < 0) out.push('Enter what it cost');
    if (d.trend !== 'manual' && !(Number(d.rate) > 0 && Number(d.rate) <= 100)) out.push('The yearly change has to be between 0 and 100 percent');
    return out;
  }, [d]);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (problems.length) return setError(problems.join('. '));
    setBusy(true);
    setError(null);
    try {
      onState(
        await client.saveAsset({
          name: d.name.trim(),
          kind: d.kind,
          originalValue: parseDollars(d.value) ?? 0,
          valueTrend: d.trend,
          trendRatePercent: d.trend === 'manual' ? null : Number(d.rate),
          acquiredDate: d.acquired || null,
        }),
      );
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!asset && !open) {
    return (
      <div className="mt-card">
        <h3>Track what this loan paid for</h3>
        <p style={{ marginTop: 0 }}>
          Add the asset (a vehicle, equipment, anything with resale value) to see equity: what it's worth minus what you owe.
        </p>
        <button type="button" className="mt-btn" onClick={() => setOpen(true)}>
          Add an asset
        </button>
      </div>
    );
  }

  return (
    <form className="mt-card" onSubmit={save}>
      <h3>{asset ? `About the ${ASSET_KIND_LABEL[asset.kind].toLowerCase()}` : 'New asset'}</h3>
      <div className="mt-form-section">
        <div className="mt-field">
          <label htmlFor="mt-as-name">Name</label>
          <input id="mt-as-name" className="mt-input" maxLength={80} value={d.name} onChange={(e) => { setSaved(false); setD({ ...d, name: e.target.value }); }} />
        </div>
        <div className="mt-field">
          <label htmlFor="mt-as-kind">Kind</label>
          <select id="mt-as-kind" className="mt-select" style={{ width: '100%' }} value={d.kind} onChange={(e) => { setSaved(false); setD({ ...d, kind: e.target.value as AssetKind }); }}>
            <option value="home">Home</option>
            <option value="vehicle">Vehicle</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="mt-field">
          <label htmlFor="mt-as-value">Original value</label>
          <div className="mt-prefix">
            <span>$</span>
            <input id="mt-as-value" className="mt-input" inputMode="decimal" value={d.value} onChange={(e) => { setSaved(false); setD({ ...d, value: e.target.value }); }} />
          </div>
          <div className="hint">What it cost. Equity uses this until you add a newer value.</div>
        </div>
        <div className="mt-field">
          <label htmlFor="mt-as-acquired">Bought on</label>
          <input id="mt-as-acquired" type="date" className="mt-input" value={d.acquired} onChange={(e) => { setSaved(false); setD({ ...d, acquired: e.target.value }); }} />
        </div>
        <div className="mt-field">
          <label htmlFor="mt-as-trend">Value over time</label>
          <select id="mt-as-trend" className="mt-select" style={{ width: '100%' }} value={d.trend} onChange={(e) => { setSaved(false); setD({ ...d, trend: e.target.value as ValueTrend }); }}>
            <option value="manual">Only the values I enter</option>
            <option value="depreciating">Project a yearly drop (estimate)</option>
            <option value="appreciating">Project a yearly rise (estimate)</option>
          </select>
        </div>
        {d.trend !== 'manual' && (
          <div className="mt-field">
            <label htmlFor="mt-as-rate">Yearly change</label>
            <div className="mt-suffix">
              <input id="mt-as-rate" className="mt-input" inputMode="decimal" value={d.rate} onChange={(e) => { setSaved(false); setD({ ...d, rate: e.target.value }); }} />
              <span>%</span>
            </div>
          </div>
        )}
      </div>
      {d.trend !== 'manual' && (
        <p className="mt-kpi-note">
          The projection only draws the curve ahead. It's an estimate, not a valuation: equity today always uses the latest value you entered.
        </p>
      )}
      {error && (
        <div className="mt-note bad" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      )}
      <div className="mt-row" style={{ marginTop: 12 }}>
        <span className="mt-spacer" />
        {saved && <span style={{ color: 'var(--good)', fontWeight: 600 }}>Saved</span>}
        <button type="submit" className="mt-btn primary" disabled={busy}>
          {asset ? 'Save' : 'Add asset'}
        </button>
      </div>
    </form>
  );
}

const ROWS: { key: keyof PeriodTotals; label: string; color?: string }[] = [
  { key: 'principal', label: 'Principal', color: 'var(--s-principal)' },
  { key: 'extraPrincipal', label: 'Extra principal' },
  { key: 'interest', label: 'Interest', color: 'var(--s-interest)' },
  { key: 'pmi', label: 'PMI', color: 'var(--s-pmi)' },
  { key: 'escrow', label: 'Escrow', color: 'var(--s-escrow)' },
  { key: 'fees', label: 'Yearly fees' },
  { key: 'deferredRepaid', label: 'Deferred balance repaid' },
];

/** Shown even when zero; the rest only appear when some period has them. */
const ALWAYS: (keyof PeriodTotals)[] = ['principal', 'interest'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function Breakouts({ periods, hasPaid, beforeTracking }: { periods: Record<PeriodBasis, PeriodBreakouts>; hasPaid: boolean; beforeTracking: boolean }) {
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
  const rows = ROWS.filter((r) => ALWAYS.includes(r.key) || cols.some((c) => c.t[r.key] !== 0));
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
            {cols.some((c) => c.t.catchUp > 0) && (
              <tr>
                <td className="muted">Of which, catching up</td>
                {cols.map((c) => (
                  <td key={c.id} className="muted">
                    {c.t.catchUp ? <Amt cents={c.t.catchUp} /> : '—'}
                  </td>
                ))}
              </tr>
            )}
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
          ? 'Reconciled payments, by the date your bank paid them. Year-end lender statements (such as Form 1098) count interest the same way.'
          : 'Every payment due in each period, whether or not it has been reconciled yet.'}{' '}
        Life of loan always includes the payments still to come.
        {beforeTracking &&
          ' Payments made before tracking began count by due date with the original schedule’s amounts, so their interest is an estimate (a little high if you paid extra back then).'}
      </div>
    </div>
  );
}
